# FastAPI application entry point: RBAC + device inventory REST API
from fastapi import FastAPI
from .routers import devices, auth
from . import db

app = FastAPI(title="AeroNet OS API Gateway")

from prometheus_fastapi_instrumentator import Instrumentator
Instrumentator().instrument(app).expose(app)

app.include_router(auth.router)
app.include_router(devices.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "api-gateway"}


@app.on_event("shutdown")
async def shutdown():
    await db.close_pool()
