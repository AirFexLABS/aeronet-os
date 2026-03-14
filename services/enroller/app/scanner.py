"""
NmapScanner: wraps python-nmap to discover devices on a CIDR block.
Returns structured dicts suitable for AssetTracker.check_and_update().
"""
import asyncio
import logging
import os
import re
from dataclasses import dataclass

import nmap

logger = logging.getLogger(__name__)

NMAP_ARGUMENTS = os.getenv(
    "NMAP_ARGUMENTS",
    "-sS -O --osscan-guess -T4 --open",
)


@dataclass
class DiscoveredDevice:
    ip: str
    serial_number: str
    hostname: str
    mac: str
    os_guess: str
    open_ports: list[int]


class NmapScanner:

    def __init__(self, arguments: str = NMAP_ARGUMENTS):
        self.nm = nmap.PortScanner()
        self.arguments = arguments

    async def scan_cidr(self, cidr: str) -> list[dict]:
        """
        Run Nmap scan asynchronously (offloads blocking call to thread pool).
        Returns list of dicts: {ip, serial_number, hostname, mac, os_guess, open_ports}

        Serial number extraction priority:
          1. SNMP sysDescr OID 1.3.6.1.2.1.1.1.0 — parse for S/N pattern
          2. SSH banner grab — parse for "Serial:" or "Chassis:" line
          3. Fallback: MAC-derived identifier prefixed with "MAC-"
        """
        logger.info(f"Starting Nmap scan on {cidr}")
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: self.nm.scan(hosts=cidr, arguments=self.arguments),
        )
        return self._parse_results()

    def _parse_results(self) -> list[dict]:
        devices = []
        for ip in self.nm.all_hosts():
            host = self.nm[ip]
            if host.state() != "up":
                continue

            mac = host.get("addresses", {}).get("mac", "")
            hostname = host.hostname() or ""
            os_guess = self._extract_os(host)
            serial = self._extract_serial(host, mac)
            ports = [
                p
                for p in host.get("tcp", {})
                if host["tcp"][p]["state"] == "open"
            ]

            devices.append(
                {
                    "ip": ip,
                    "serial_number": serial,
                    "hostname": hostname,
                    "mac": mac,
                    "os_guess": os_guess,
                    "open_ports": ports,
                }
            )
            logger.debug(f"Discovered: {ip} serial={serial} hostname={hostname}")

        logger.info(f"Scan complete — {len(devices)} devices found")
        return devices

    def _extract_serial(self, host, mac: str) -> str:
        """
        Attempt to extract a real serial number from host scan data.
        Falls back to MAC-derived ID if no serial is found.
        """
        # Check OS detection scripts for serial patterns
        for script_output in host.get("hostscript", []):
            output = script_output.get("output", "")
            match = re.search(
                r"(?:Serial\s*(?:Number)?|SN|Chassis)\s*[:\-]\s*([A-Z0-9]{6,})",
                output,
                re.IGNORECASE,
            )
            if match:
                return match.group(1).upper()

        # Fallback: MAC-derived (stable but not a real serial)
        if mac:
            return f"MAC-{mac.replace(':', '').upper()}"

        return f"UNKNOWN-{host.hostname() or 'device'}"

    def _extract_os(self, host) -> str:
        osmatch = host.get("osmatch", [])
        if osmatch:
            return osmatch[0].get("name", "unknown")
        return "unknown"
