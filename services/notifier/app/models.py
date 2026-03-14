# Pydantic models for the notifier service
from pydantic import BaseModel
from typing import Literal


class AlertPayload(BaseModel):
    serial:   str
    severity: Literal["INFO", "WARNING", "CRITICAL", "ERROR"]
    message:  str


class GrafanaWebhookPayload(BaseModel):
    title:   str
    message: str = ""
    state:   str = "alerting"    # "alerting" | "ok" | "no_data"
    alerts:  list[dict] = []
