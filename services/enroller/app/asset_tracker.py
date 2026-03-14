# Asset Moved detection and notification logic
import asyncio
import logging
import os
import xml.etree.ElementTree as ET

import httpx

from . import db

logger = logging.getLogger(__name__)

NOTIFIER_URL = os.environ["NOTIFIER_URL"]


class AssetTracker:
    """Discovers network devices via Nmap and detects asset-moved events."""

    def __init__(self) -> None:
        self._http = httpx.AsyncClient(timeout=10.0)

    async def close(self) -> None:
        """Release HTTP client resources."""
        await self._http.aclose()

    async def scan_cidr(self, cidr: str) -> list[dict]:
        """
        Run Nmap on the given CIDR block.
        Return a list of dicts: [{ip, serial_number, hostname}]

        Uses Nmap XML output with -sn (ping scan) and parses
        serial_number from the MAC vendor or hostname heuristic.
        """
        proc = await asyncio.create_subprocess_exec(
            "nmap", "-sn", "-oX", "-", cidr,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        if proc.returncode != 0:
            logger.error("Nmap scan failed: %s", stderr.decode())
            return []

        return self._parse_nmap_xml(stdout.decode())

    @staticmethod
    def _parse_nmap_xml(xml_data: str) -> list[dict]:
        """Parse Nmap XML output into a list of discovered devices."""
        devices: list[dict] = []
        root = ET.fromstring(xml_data)

        for host in root.findall("host"):
            addr_elem = host.find("address[@addrtype='ipv4']")
            if addr_elem is None:
                continue

            ip = addr_elem.get("addr", "")
            hostname = ""
            hostnames_elem = host.find("hostnames/hostname")
            if hostnames_elem is not None:
                hostname = hostnames_elem.get("name", "")

            mac_elem = host.find("address[@addrtype='mac']")
            serial_number = mac_elem.get("addr", "") if mac_elem is not None else ""

            if not serial_number:
                continue

            devices.append({
                "ip": ip,
                "serial_number": serial_number,
                "hostname": hostname or ip,
            })

        return devices

    async def check_and_update(self, discovered: list[dict]) -> None:
        """
        For each discovered device:
          1. Query DB for existing record by serial_number.
          2. If serial_number exists AND ip_address differs from DB record:
               - Call notify_asset_moved() BEFORE updating the DB.
               - Log to audit_logs: event_type='ASSET_MOVED', severity='CRITICAL'.
          3. Upsert the device record in DB.
        """
        for device in discovered:
            serial = device["serial_number"]
            new_ip = device["ip"]
            hostname = device["hostname"]

            existing = await db.get_device_by_serial(serial)

            if existing is not None:
                old_ip = str(existing["ip_address"])
                if old_ip != new_ip:
                    await self.notify_asset_moved(serial, old_ip, new_ip)
                    await db.insert_audit_log(
                        event_type="ASSET_MOVED",
                        severity="CRITICAL",
                        device_serial=serial,
                        message=f"Device moved from {old_ip} to {new_ip}",
                    )

            await db.upsert_device(
                serial_number=serial,
                hostname=hostname,
                ip_address=new_ip,
            )

    async def notify_asset_moved(self, serial: str, old_ip: str, new_ip: str) -> None:
        """
        POST to the notifier service /alert endpoint.
        Payload includes: serial, old_ip, new_ip, severity='CRITICAL'
        """
        payload = {
            "serial": serial,
            "old_ip": old_ip,
            "new_ip": new_ip,
            "severity": "CRITICAL",
            "event_type": "ASSET_MOVED",
            "message": f"Device {serial} moved from {old_ip} to {new_ip}",
        }
        try:
            resp = await self._http.post(f"{NOTIFIER_URL}/alert", json=payload)
            resp.raise_for_status()
            logger.info("Asset-moved alert sent for %s", serial)
        except httpx.HTTPError as exc:
            logger.error("Failed to send asset-moved alert for %s: %s", serial, exc)
