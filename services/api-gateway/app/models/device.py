# Pydantic models for device inventory
from pydantic import BaseModel
from typing import Optional


class DeviceCreate(BaseModel):
    serial_number: str
    hostname:      str
    ip_address:    str
    device_type:   str = "unknown"
    site_id:       str = "default"
    status:        str = "active"


class DeviceUpdate(BaseModel):
    hostname:    Optional[str] = None
    ip_address:  Optional[str] = None
    device_type: Optional[str] = None
    site_id:     Optional[str] = None
    status:      Optional[str] = None


class DeviceOut(BaseModel):
    serial_number: str
    hostname:      str
    ip_address:    str
    device_type:   str
    site_id:       str
    status:        str
    last_seen:     Optional[str] = None
