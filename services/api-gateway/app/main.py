# FastAPI application entry point: RBAC + device inventory REST API
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from .routers import devices, auth, vault, alert_contacts, vlans, vendor_explorer
from . import db

app = FastAPI(title="AeroNet OS API Gateway")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://aeronet.local"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Instrumentator().instrument(app).expose(app)

app.include_router(auth.router)
app.include_router(devices.router)
app.include_router(vault.router)
app.include_router(alert_contacts.router)
app.include_router(vlans.router)
app.include_router(vendor_explorer.router)

@app.get("/health")
async def health():
    return {"status": "ok", "service": "api-gateway"}

@app.on_event("shutdown")
async def shutdown():
    await db.close_pool()