# Juniper MIST API polling worker with adaptive backoff
import asyncio
import logging
import os

import httpx

from . import db

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level constants
# ---------------------------------------------------------------------------
POLL_INTERVAL_DEFAULT = 60          # Normal operation interval (seconds)
POLL_INTERVAL_MAX = 600             # Absolute backoff ceiling (seconds)
ERROR_THRESHOLD = 5                 # Consecutive errors before adaptive slowdown
ERROR_SLOWDOWN_MULTIPLIER = 2       # Multiply current interval on threshold breach

MIST_API_BASE = "https://api.mist.com"


class AuthenticationError(Exception):
    """Raised on 401 to terminate the poll loop."""


class MistWorker:
    """Polls Juniper MIST API for device stats and syncs to DB."""

    def __init__(
        self,
        api_token: str,
        site_id: str,
        poll_interval: int = POLL_INTERVAL_DEFAULT,
        error_threshold: int = ERROR_THRESHOLD,
        max_interval: int = POLL_INTERVAL_MAX,
    ) -> None:
        if not api_token:
            raise EnvironmentError("MIST_API_TOKEN is required but missing or empty")
        if not site_id:
            raise EnvironmentError("MIST_SITE_ID is required but missing or empty")

        self.api_token = api_token
        self.site_id = site_id
        self.poll_interval = poll_interval
        self.error_threshold = error_threshold
        self.max_interval = max_interval

        self.current_interval: int = poll_interval
        self.consecutive_errors: int = 0
        self.backoff_exponent: int = 0
        self._slowdown_alerted: bool = False

        self._notifier_url = os.environ["NOTIFIER_URL"]
        self._http = httpx.AsyncClient(timeout=10.0)

    async def close(self) -> None:
        """Release HTTP client resources."""
        await self._http.aclose()

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------
    async def poll(self) -> None:
        """
        Main loop:
          1. Call fetch_devices().
          2. Sleep self.current_interval seconds.
          3. Never exit unless an AuthenticationError is raised.
        """
        logger.info(
            "MIST poller started — site=%s interval=%ds",
            self.site_id,
            self.current_interval,
        )
        while True:
            await self.fetch_devices()
            await asyncio.sleep(self.current_interval)

    # ------------------------------------------------------------------
    # Fetch + dispatch
    # ------------------------------------------------------------------
    async def fetch_devices(self) -> None:
        """
        GET /api/v1/sites/{site_id}/stats/devices
        Handles 200, 429, 401, and generic errors per spec.
        """
        url = f"{MIST_API_BASE}/api/v1/sites/{self.site_id}/stats/devices"
        headers = {"Authorization": f"Token {self.api_token}"}

        try:
            resp = await self._http.get(url, headers=headers)
        except httpx.HTTPError as exc:
            # Network-level failure (timeout, DNS, connection refused, etc.)
            self.consecutive_errors += 1
            await db.insert_audit_log(
                event_type="POLL_ERROR",
                severity="WARNING",
                message=f"Network error: {exc}",
            )
            self._apply_adaptive_slowdown()
            return

        # --- 200 OK ---------------------------------------------------------
        if resp.status_code == 200:
            self.consecutive_errors = 0
            self.backoff_exponent = 0
            self._slowdown_alerted = False
            self.current_interval = self.poll_interval
            await self.parse_and_sync(resp.json())
            return

        # --- 429 Rate Limited ------------------------------------------------
        if resp.status_code == 429:
            wait = min(60 * (2 ** self.backoff_exponent), self.max_interval)
            self.backoff_exponent += 1
            self.consecutive_errors += 1

            await db.insert_audit_log(
                event_type="RATE_LIMITED",
                severity="WARNING",
                message=f"429 received, backing off {wait}s (exponent={self.backoff_exponent})",
            )
            await self._post_alert(
                event_type="RATE_LIMITED",
                severity="WARNING",
                message=f"MIST API rate-limited, backing off {wait}s",
            )

            logger.warning("Rate-limited by MIST API, sleeping %ds", wait)
            await asyncio.sleep(wait)
            return

        # --- 401 Unauthorized ------------------------------------------------
        if resp.status_code == 401:
            await db.insert_audit_log(
                event_type="AUTH_FAILURE",
                severity="ERROR",
                message="401 Unauthorized from MIST API — token may be invalid or expired",
            )
            await self._post_alert(
                event_type="AUTH_FAILURE",
                severity="CRITICAL",
                message="MIST API authentication failed — manual intervention required",
            )
            raise AuthenticationError("MIST API returned 401 — terminating poll loop")

        # --- Any other HTTP error --------------------------------------------
        self.consecutive_errors += 1
        await db.insert_audit_log(
            event_type="POLL_ERROR",
            severity="WARNING",
            message=f"HTTP {resp.status_code}: {resp.text[:200]}",
        )
        self._apply_adaptive_slowdown()

    # ------------------------------------------------------------------
    # Adaptive slowdown
    # ------------------------------------------------------------------
    def _apply_adaptive_slowdown(self) -> None:
        """
        If consecutive_errors >= error_threshold, double the current_interval
        (capped at max_interval). Fire one alert per slowdown event.
        """
        if self.consecutive_errors < self.error_threshold:
            return

        self.current_interval = min(
            self.current_interval * ERROR_SLOWDOWN_MULTIPLIER,
            self.max_interval,
        )

        logger.warning(
            "Adaptive slowdown: interval=%ds after %d consecutive errors",
            self.current_interval,
            self.consecutive_errors,
        )

        # Audit log is fire-and-forget from a sync context; schedule it.
        asyncio.ensure_future(
            db.insert_audit_log(
                event_type="ADAPTIVE_SLOWDOWN",
                severity="WARNING",
                message=(
                    f"Interval increased to {self.current_interval}s "
                    f"after {self.consecutive_errors} consecutive errors"
                ),
            )
        )

        if not self._slowdown_alerted:
            asyncio.ensure_future(
                self._post_alert(
                    event_type="ADAPTIVE_SLOWDOWN",
                    severity="WARNING",
                    message=(
                        f"MIST collector slowed to {self.current_interval}s interval "
                        f"after {self.consecutive_errors} consecutive errors"
                    ),
                )
            )
            self._slowdown_alerted = True

    # ------------------------------------------------------------------
    # Parse + sync
    # ------------------------------------------------------------------
    async def parse_and_sync(self, devices: list[dict]) -> None:
        """
        For each device: extract serial, switch hostname, switch port from
        lldp_stat and upsert into connectivity_matrix.
        Skip silently if lldp_stat is missing or null.
        """
        for device in devices:
            serial = device.get("serial")
            lldp = device.get("lldp_stat")

            if not serial or not lldp:
                continue

            switch_host = lldp.get("system_name")
            switch_port = lldp.get("port_id")

            if not switch_host or not switch_port:
                continue

            await db.upsert_connectivity(
                ap_serial=serial,
                switch_hostname=switch_host,
                switch_port=switch_port,
            )

        logger.info("Synced %d devices from MIST API", len(devices))

    # ------------------------------------------------------------------
    # Alert helper
    # ------------------------------------------------------------------
    async def _post_alert(
        self,
        event_type: str,
        severity: str,
        message: str,
    ) -> None:
        """POST an alert to the notifier service."""
        payload = {
            "event_type": event_type,
            "severity": severity,
            "message": message,
            "source": "collector",
        }
        try:
            resp = await self._http.post(f"{self._notifier_url}/alert", json=payload)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            logger.error("Failed to send alert to notifier: %s", exc)
