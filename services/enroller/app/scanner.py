"""
NmapScanner: wraps python-nmap to discover devices on a CIDR block.
Returns structured dicts suitable for AssetTracker.check_and_update().
"""
import asyncio
import logging
import os
import re
from dataclasses import dataclass

import httpx
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

AP_VENDORS = {"Cisco Aironet", "Ubiquiti", "Aruba", "Juniper Mist", "Ruckus"}

NETWORK_VENDORS = {"Cisco", "Cisco Systems", "Cisco Aironet", "Juniper", "Juniper Mist",
                   "HP", "Dell", "Aruba", "Ubiquiti", "Ruckus"}

NMAP_ARGUMENTS = os.getenv(
    "NMAP_ARGUMENTS",
    "-sS -sV -sC -O --osscan-guess -T4 --open",
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

            vendor = _lookup_vendor(mac, host.get("vendor", {}))
            device_type = _classify_device(hostname, ports, vendor, os_guess)

            devices.append(
                {
                    "ip": ip,
                    "serial_number": serial,
                    "hostname": hostname,
                    "mac": mac,
                    "os_guess": os_guess,
                    "open_ports": ports,
                    "vendor": vendor,
                    "device_type": device_type,
                }
            )
            logger.debug(f"Discovered: {ip} serial={serial} hostname={hostname} "
                         f"vendor={vendor} type={device_type}")

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


def _lookup_vendor(mac: str, nmap_vendor: dict | None = None) -> str:
    """Resolve vendor from nmap's vendor dict first, then static OUI_MAP fallback."""
    if nmap_vendor:
        # nmap returns {mac_addr: vendor_name} from its full OUI database
        for vendor_name in nmap_vendor.values():
            if vendor_name:
                return vendor_name

    if not mac:
        return "unknown"
    prefix = mac.lower()[:8]  # first 3 octets e.g. "00:0b:86"
    return OUI_MAP.get(prefix, "unknown")


def _classify_device(
    hostname: str,
    open_ports: list[int],
    vendor: str,
    os_guess: str = "",
) -> str:
    """Classify a device as router/switch/ap/server/printer/unknown."""
    hn = hostname.lower()
    os_lower = os_guess.lower() if os_guess else ""

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

    # OS-based classification
    if os_lower:
        if "switch" in os_lower or "catalyst" in os_lower:
            return "switch"
        if "router" in os_lower or "asr" in os_lower or "isr" in os_lower:
            return "router"
        if "wireless" in os_lower or "wlc" in os_lower:
            return "ap"
        if "printer" in os_lower or "print" in os_lower:
            return "printer"
        if "firewall" in os_lower or "asa" in os_lower or "pix" in os_lower:
            return "firewall"

    # Port-based heuristics
    has_ssh = 22 in port_set
    has_telnet = 23 in port_set
    has_http = bool(port_set & {80, 443})
    has_snmp = 161 in port_set
    is_network_vendor = vendor in NETWORK_VENDORS

    if has_ssh and has_telnet and not has_http:
        return "router"
    if (has_telnet or has_ssh) and has_snmp and is_network_vendor:
        return "switch"
    if has_ssh and has_snmp:
        return "switch"
    if has_telnet and has_snmp:
        return "switch"
    if has_http and not has_ssh and not has_telnet:
        return "server"

    return "unknown"


API_GATEWAY_URL = os.getenv("API_GATEWAY_URL", "http://api-gateway:8000")
API_GATEWAY_TOKEN = os.getenv("API_GATEWAY_TOKEN", "")


async def get_snmp_description(ip: str, community: str = "public") -> str | None:
    """
    Query SNMP OID 1.3.6.1.2.1.1.1.0 (sysDescr) for device description.
    Uses pysnmp. Returns None if unreachable or no SNMP.
    Timeout: 2 seconds.
    """
    try:
        from pysnmp.hlapi.v3arch.asyncio import (
            CommunityData,
            ObjectIdentity,
            ObjectType,
            SnmpEngine,
            UdpTransportTarget,
            get_cmd,
        )

        engine = SnmpEngine()
        error_indication, error_status, _, var_binds = await get_cmd(
            engine,
            CommunityData(community),
            await UdpTransportTarget.create((ip, 161), timeout=2, retries=0),
            ObjectType(ObjectIdentity("1.3.6.1.2.1.1.1.0")),
        )
        engine.close_dispatcher()
        if error_indication or error_status:
            return None
        for _, val in var_binds:
            desc = str(val).strip()
            if desc:
                return desc[:256]
        return None
    except Exception:
        logger.debug(f"SNMP query failed for {ip} with community '{community[:4]}...'")
        return None


async def enrich_with_vault_snmp(ip: str, site_id: str | None = None) -> str | None:
    """
    Look up SNMP community strings from vault for this IP's site.
    Try each community string until one works.
    Returns sysDescr if successful, None otherwise.
    """
    if not API_GATEWAY_TOKEN:
        return None

    try:
        headers = {
            "Authorization": f"Bearer {API_GATEWAY_TOKEN}",
            "x-source-service": "enroller",
        }
        # Fetch SNMP v2 credentials from vault, filtered by scope
        params = "type=snmp_v2_community&active=true"
        if site_id:
            params += f"&scope={site_id}"

        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{API_GATEWAY_URL}/vault?{params}", headers=headers)
            if r.status_code != 200:
                return None
            vault_entries = r.json()

            # Also try global-scoped entries
            if site_id:
                r2 = await client.get(
                    f"{API_GATEWAY_URL}/vault?type=snmp_v2_community&active=true&scope=global",
                    headers=headers,
                )
                if r2.status_code == 200:
                    vault_entries.extend(r2.json())

            # Try each community string from the vault
            for entry in vault_entries:
                use_r = await client.post(
                    f"{API_GATEWAY_URL}/vault/{entry['id']}/use",
                    headers=headers,
                )
                if use_r.status_code != 200:
                    continue
                community = use_r.json().get("value", "")
                if not community:
                    continue

                desc = await get_snmp_description(ip, community)
                if desc:
                    return desc

    except Exception:
        logger.debug(f"Vault SNMP enrichment failed for {ip}")

    return None


async def fingerprint_device(ip: str) -> dict:
    """
    Fingerprint a single IP address: run an Nmap scan and return enriched
    device information including vendor, device class, and confidence score.
    """
    scanner = NmapScanner(
        arguments="-sS -sV -sC -O --osscan-guess -sU -p U:161 -T4 --open",
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

    vendor = _lookup_vendor(mac, host.get("vendor", {}))
    device_class = _classify_device(hostname, open_ports, vendor, os_guess)

    # SNMP description from host scripts
    snmp_desc = None
    for script_output in host.get("hostscript", []):
        if "snmp" in script_output.get("id", "").lower():
            snmp_desc = script_output.get("output", "")[:256]
            break

    # If no SNMP description from Nmap, try vault community strings
    if snmp_desc is None and 161 in set(open_ports):
        vault_desc = await enrich_with_vault_snmp(ip)
        if vault_desc:
            snmp_desc = vault_desc

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
