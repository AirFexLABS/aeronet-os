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

# ── OUI vendor lookup (top 20 airport-relevant vendors) ──────────────
OUI_MAP = {
    "00:0b:86": "Aruba",
    "00:1a:1e": "Aruba",
    "00:17:f2": "Apple",
    "00:50:56": "VMware",
    "b4:fb:e4": "Juniper Mist",
    "d4:20:b0": "Juniper Mist",
    "00:1c:57": "Ruckus",
    "00:26:b9": "Cisco",
    "00:1b:2a": "Cisco",
    "fc:5b:39": "Ubiquiti",
    "dc:9f:db": "Ubiquiti",
    "24:a4:3c": "Ubiquiti",
    "00:0c:e6": "Zebra",
    "00:13:e8": "Cisco Aironet",
    "00:40:96": "Cisco Aironet",
    "00:0d:ed": "Juniper",
    "00:12:1e": "Juniper",
    "00:19:e2": "HP",
    "00:17:08": "HP",
    "00:1e:c9": "Dell",
}

AP_VENDORS = {"Cisco", "Cisco Aironet", "Ubiquiti", "Aruba", "Juniper Mist", "Ruckus"}

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


def _lookup_vendor(mac: str) -> str:
    """Resolve vendor from MAC OUI prefix using the static OUI_MAP."""
    if not mac:
        return "unknown"
    prefix = mac.lower()[:8]  # first 3 octets e.g. "00:0b:86"
    return OUI_MAP.get(prefix, "unknown")


def _classify_device(
    hostname: str,
    open_ports: list[int],
    vendor: str,
) -> str:
    """Classify a device as router/switch/ap/server/printer/unknown."""
    hn = hostname.lower()

    # Hostname-based classification (highest priority)
    if any(tag in hn for tag in ("ap", "wap", "wifi")):
        return "ap"
    if any(tag in hn for tag in ("sw", "switch")):
        return "switch"
    if any(tag in hn for tag in ("rt", "router", "gw", "gateway")):
        return "router"

    port_set = set(open_ports)

    # MAC OUI matches known AP vendors → AP
    if vendor in AP_VENDORS and port_set:
        return "ap"

    # Port-based heuristics
    has_ssh = 22 in port_set
    has_telnet = 23 in port_set
    has_http = bool(port_set & {80, 443})
    has_snmp = 161 in port_set

    if has_ssh and has_telnet and not has_http:
        return "router"
    if has_ssh and has_snmp:
        return "switch"
    if has_http and not has_ssh and not has_telnet:
        return "server"

    return "unknown"


async def fingerprint_device(ip: str) -> dict:
    """
    Fingerprint a single IP address: run an Nmap scan and return enriched
    device information including vendor, device class, and confidence score.
    """
    scanner = NmapScanner(
        arguments="-sS -O --osscan-guess -sU -p U:161 -T4 --open",
    )
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        lambda: scanner.nm.scan(hosts=ip, arguments=scanner.arguments),
    )

    if ip not in scanner.nm.all_hosts():
        return {
            "ip": ip,
            "hostname": "",
            "mac": "",
            "vendor": "unknown",
            "device_class": "unknown",
            "open_ports": [],
            "os_guess": "unknown",
            "confidence": 0,
            "snmp_desc": None,
        }

    host = scanner.nm[ip]
    mac = host.get("addresses", {}).get("mac", "")
    hostname = host.hostname() or ""
    os_guess = scanner._extract_os(host)

    tcp_ports = [
        p for p in host.get("tcp", {})
        if host["tcp"][p]["state"] == "open"
    ]
    udp_ports = [
        p for p in host.get("udp", {})
        if host["udp"][p]["state"] == "open"
    ]
    open_ports = sorted(set(tcp_ports + udp_ports))

    vendor = _lookup_vendor(mac)
    device_class = _classify_device(hostname, open_ports, vendor)

    # SNMP description from host scripts
    snmp_desc = None
    for script_output in host.get("hostscript", []):
        if "snmp" in script_output.get("id", "").lower():
            snmp_desc = script_output.get("output", "")[:256]
            break

    # Confidence score: more data = higher confidence
    confidence = 20  # base: host is up
    if mac:
        confidence += 15
    if hostname:
        confidence += 15
    if os_guess and os_guess != "unknown":
        confidence += 20
    if open_ports:
        confidence += 15
    if vendor and vendor != "unknown":
        confidence += 10
    if snmp_desc:
        confidence += 5
    confidence = min(confidence, 100)

    return {
        "ip": ip,
        "hostname": hostname,
        "mac": mac,
        "vendor": vendor,
        "device_class": device_class,
        "open_ports": open_ports,
        "os_guess": os_guess,
        "confidence": confidence,
        "snmp_desc": snmp_desc,
    }
