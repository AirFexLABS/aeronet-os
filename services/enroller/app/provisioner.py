"""
ScrapliProvisioner: SSH-based device provisioning via Scrapli.
Supports: Cisco IOS, IOS-XE, NX-OS, Juniper JunOS.
All credentials pulled from the DB credentials table (never hardcoded).
"""
import logging
import os
from dataclasses import dataclass

import asyncpg
from scrapli import AsyncScrapli
from scrapli.exceptions import ScrapliException

logger = logging.getLogger(__name__)

PLATFORM_MAP = {
    "IOS": "cisco_iosxe",
    "IOS-XE": "cisco_iosxe",
    "NX-OS": "cisco_nxos",
    "JunOS": "juniper_junos",
}

SSH_TIMEOUT = int(os.getenv("SCRAPLI_SSH_TIMEOUT", "30"))
AUTH_TIMEOUT = int(os.getenv("SCRAPLI_AUTH_TIMEOUT", "20"))


@dataclass
class ProvisionResult:
    serial: str
    ip: str
    platform: str
    success: bool
    output: str
    error: str = ""


class ScrapliProvisioner:

    def __init__(self, db: asyncpg.Connection):
        self.db = db

    async def provision(
        self,
        serial: str,
        ip: str,
        platform: str,
        commands: list[str],
    ) -> ProvisionResult:
        """
        Connect to a device and send configuration commands.
        Credentials are fetched from the credentials table by serial_number.
        Raises no exceptions — all errors are captured in ProvisionResult.
        """
        scrapli_platform = PLATFORM_MAP.get(platform)
        if not scrapli_platform:
            return ProvisionResult(
                serial=serial,
                ip=ip,
                platform=platform,
                success=False,
                output="",
                error=f"Unsupported platform: {platform}",
            )

        creds = await self._fetch_credentials(serial)
        if not creds:
            return ProvisionResult(
                serial=serial,
                ip=ip,
                platform=platform,
                success=False,
                output="",
                error=f"No credentials found for serial {serial}",
            )

        username, password = creds
        device = {
            "host": ip,
            "auth_username": username,
            "auth_password": password,
            "auth_strict_key": False,
            "platform": scrapli_platform,
            "timeout_socket": SSH_TIMEOUT,
            "timeout_transport": AUTH_TIMEOUT,
            "transport": "asyncssh",
        }

        try:
            async with AsyncScrapli(**device) as conn:
                outputs = []
                for cmd in commands:
                    resp = await conn.send_config(cmd)
                    outputs.append(resp.result)
                    if resp.failed:
                        logger.warning(
                            f"Command failed on {serial} ({ip}): {cmd}"
                        )
                combined = "\n".join(outputs)
                logger.info(
                    f"Provisioned {serial} ({ip}) — {len(commands)} commands"
                )
                return ProvisionResult(
                    serial=serial,
                    ip=ip,
                    platform=platform,
                    success=True,
                    output=combined,
                )

        except ScrapliException as e:
            logger.error(f"Scrapli error on {serial} ({ip}): {e}")
            return ProvisionResult(
                serial=serial,
                ip=ip,
                platform=platform,
                success=False,
                output="",
                error=str(e),
            )

    async def get_running_config(
        self, serial: str, ip: str, platform: str
    ) -> ProvisionResult:
        """
        Retrieve the running configuration from a device.
        Uses platform-appropriate command:
          IOS/IOS-XE/NX-OS → show running-config
          JunOS             → show configuration
        """
        cmd_map = {
            "cisco_iosxe": "show running-config",
            "cisco_nxos": "show running-config",
            "juniper_junos": "show configuration",
        }
        scrapli_platform = PLATFORM_MAP.get(platform, "cisco_iosxe")
        cmd = cmd_map.get(scrapli_platform, "show running-config")

        creds = await self._fetch_credentials(serial)
        if not creds:
            return ProvisionResult(
                serial=serial,
                ip=ip,
                platform=platform,
                success=False,
                output="",
                error=f"No credentials found for serial {serial}",
            )

        username, password = creds
        device = {
            "host": ip,
            "auth_username": username,
            "auth_password": password,
            "auth_strict_key": False,
            "platform": scrapli_platform,
            "timeout_socket": SSH_TIMEOUT,
            "timeout_transport": AUTH_TIMEOUT,
            "transport": "asyncssh",
        }

        try:
            async with AsyncScrapli(**device) as conn:
                resp = await conn.send_command(cmd)
                return ProvisionResult(
                    serial=serial,
                    ip=ip,
                    platform=platform,
                    success=not resp.failed,
                    output=resp.result,
                )
        except ScrapliException as e:
            return ProvisionResult(
                serial=serial,
                ip=ip,
                platform=platform,
                success=False,
                output="",
                error=str(e),
            )

    async def _fetch_credentials(
        self, serial: str
    ) -> tuple[str, str] | None:
        """
        Fetch and decrypt credentials from DB.
        Returns (username, plaintext_password) or None.

        NOTE: encrypted_password is stored as a Fernet-encrypted string.
        CREDENTIALS_ENCRYPTION_KEY env var must be a valid Fernet key.
        """
        from cryptography.fernet import Fernet

        key = os.environ.get("CREDENTIALS_ENCRYPTION_KEY")
        if not key:
            logger.error("CREDENTIALS_ENCRYPTION_KEY not set")
            return None

        row = await self.db.fetchrow(
            """
            SELECT username, encrypted_password
            FROM credentials
            WHERE device_serial = $1
            LIMIT 1
            """,
            serial,
        )
        if not row:
            return None

        fernet = Fernet(key.encode())
        plaintext = fernet.decrypt(
            row["encrypted_password"].encode()
        ).decode()
        return row["username"], plaintext
