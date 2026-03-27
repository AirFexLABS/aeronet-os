# Pydantic models for device inventory
from pydantic import BaseModel
from typing import Optional


class DeviceCreate(BaseModel):
    serial_number: str
    hostname:      str
    ip_address:    str
    mac_address:   Optional[str] = None
    device_type:   str = "unknown"
    vendor:        str = "unknown"
    os_guess:      str = "unknown"
    site_id:       str = "default"
    status:        str = "active"


class DeviceUpdate(BaseModel):
    hostname:    Optional[str] = None
    ip_address:  Optional[str] = None
    mac_address: Optional[str] = None
    device_type: Optional[str] = None
    vendor:      Optional[str] = None
    os_guess:    Optional[str] = None
    site_id:     Optional[str] = None
    status:      Optional[str] = None


class DeviceOut(BaseModel):
    serial_number: str
    hostname:      str
    ip_address:    str
    mac_address:   Optional[str] = None
    device_type:   str
    vendor:        str = "unknown"
    os_guess:      str = "unknown"
    site_id:       str
    status:        str
    last_seen:     Optional[str] = None
