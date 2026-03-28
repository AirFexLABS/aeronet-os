"""
Enroller service — FastAPI app with scheduled and on-demand Nmap scanning.
Schedule: every 30 minutes against all CIDR blocks in SCAN_TARGETS env var.
On-demand: POST /scan triggers an immediate scan of a specified CIDR.
"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, BackgroundTasks
from prometheus_fastapi_instrumentator import Instrumentator
from pydantic import BaseModel

from app.scanner import NmapScanner, fingerprint_device
from app.asset_tracker import AssetTracker
from app.db import get_pool, close_pool

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

SCAN_TARGETS_ENV = [c.strip() for c in os.getenv("SCAN_TARGETS", "").split(",") if c.strip()]
SCAN_INTERVAL = int(os.getenv("SCAN_INTERVAL_MINUTES", "30"))

scanner = NmapScanner()
scheduler = AsyncIOScheduler()

# Populated at startup from vlans table (or env fallback)
SCAN_TARGETS: list[str] = []


async def _load_scan_targets() -> list[str]:
    """Load active VLAN CIDRs from the vlans table.

    Falls back to SCAN_TARGETS env var if the DB query fails
    (table missing, connection error, etc.).
    """
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT cidr::text FROM vlans "
                "WHERE scan_enabled = true AND status = 'active' "
                "ORDER BY vlan_id"
            )
        cidrs = [row["cidr"] for row in rows]
        if cidrs:
            logger.info(f"SCAN_TARGETS loaded from DB: {cidrs}")
            return cidrs
        logger.warning("No active VLANs in DB — falling back to env")
    except Exception as exc:
        logger.warning(f"Failed to load VLANs from DB ({exc}) — falling back to env")

    if SCAN_TARGETS_ENV:
        logger.info(f"SCAN_TARGETS loaded from env fallback: {SCAN_TARGETS_ENV}")
    return SCAN_TARGETS_ENV


async def _run_scheduled_scan():
    """Called by APScheduler every SCAN_INTERVAL minutes."""
    global SCAN_TARGETS
    SCAN_TARGETS = await _load_scan_targets()

    pool = await get_pool()
    async with pool.acquire() as conn:
        tracker = AssetTracker()
        for cidr in SCAN_TARGETS:
            if not cidr:
                continue
            logger.info(f"Scheduled scan starting: {cidr}")
            discovered = await scanner.scan_cidr(cidr)
            await tracker.check_and_update(discovered)
        await tracker.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global SCAN_TARGETS
    SCAN_TARGETS = await _load_scan_targets()

    if SCAN_TARGETS:
        scheduler.add_job(
            _run_scheduled_scan,
            "interval",
            minutes=SCAN_INTERVAL,
            id="nmap-scheduled",
            replace_existing=True,
        )
        scheduler.start()
        logger.info(
            f"Scheduled scanner started — "
            f"targets: {SCAN_TARGETS}, interval: {SCAN_INTERVAL}m"
        )
    else:
        logger.warning("No SCAN_TARGETS configured — scheduled scanning disabled")
    yield
    scheduler.shutdown(wait=False)
    await close_pool()


app = FastAPI(title="AeroNet Enroller", lifespan=lifespan)
Instrumentator().instrument(app).expose(app)


class ScanRequest(BaseModel):
    cidr: str
    comment: str = ""


class DiscoverRequest(BaseModel):
    cidr: str
    timeout: int = 30


class CheckRequest(BaseModel):
    serial_number: str
    ip: str
    hostname: str = ""


@app.get("/health")
async def health():
    return {"status": "ok", "service": "enroller"}


@app.post("/scan", status_code=202)
async def trigger_scan(
    req: ScanRequest,
    background_tasks: BackgroundTasks,
):
    """
    Trigger an immediate on-demand Nmap scan.
    Runs in the background — returns 202 immediately.
    """

    async def _run():
        pool = await get_pool()
        async with pool.acquire() as conn:
            tracker = AssetTracker()
            discovered = await scanner.scan_cidr(req.cidr)
            await tracker.check_and_update(discovered)
            await tracker.close()

    background_tasks.add_task(_run)
    return {
        "status": "accepted",
        "cidr": req.cidr,
        "message": f"Scan of {req.cidr} started in background",
    }


@app.post("/check", status_code=202)
async def check_device(req: CheckRequest):
    """Internal: check a single device by serial + IP."""
    tracker = AssetTracker()
    await tracker.check_and_update(
        [
            {
                "serial_number": req.serial_number,
                "ip": req.ip,
                "hostname": req.hostname,
            }
        ]
    )
    await tracker.close()
    return {"status": "accepted"}


@app.post("/discover")
async def discover_network(req: DiscoverRequest) -> list[dict]:
    """
    Scan a CIDR block and return fingerprinted device list.
    Runs synchronously (up to timeout) — returns results directly.
    """
    import ipaddress

    try:
        ipaddress.ip_network(req.cidr, strict=False)
    except ValueError:
        from fastapi import HTTPException

        raise HTTPException(status_code=422, detail="Invalid CIDR format")

    results = await asyncio.wait_for(
        scanner.scan_cidr(req.cidr),
        timeout=max(req.timeout, 60),
    )
    return results


@app.get("/sites")
async def list_sites() -> list[str]:
    """Return distinct site_ids from the devices table for the site selector."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT site_id FROM devices ORDER BY site_id"
        )
    return [row["site_id"] for row in rows]
