"""
Collector service — FastAPI wrapper around MistWorker background poll loop.
Exposes /health and /metrics. Poll loop starts on app startup via lifespan.
"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator

from .mist_worker import MistWorker
from . import db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start MistWorker poll loop on startup. Cancel on shutdown."""
    worker = MistWorker(
        api_token=os.environ["MIST_API_TOKEN"],
        site_id=os.environ["MIST_SITE_ID"],
        poll_interval=int(os.getenv("MIST_POLL_INTERVAL", "60")),
        error_threshold=int(os.getenv("MIST_ERROR_THRESHOLD", "5")),
    )
    task = asyncio.create_task(worker.poll())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    await worker.close()
    await db.close_pool()


app = FastAPI(title="AeroNet Collector", lifespan=lifespan)
Instrumentator().instrument(app).expose(app)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "collector"}
