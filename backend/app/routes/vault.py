from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import User
from app.schemas import VaultResponse, VaultUpdateRequest, ExportResponse
from app.services.crypto import verify_jwt
from app.services.metrics import vault_operations
import json

router = APIRouter(prefix="/vault", tags=["vault"])

@router.get("/", response_model=VaultResponse)
async def get_vault(request: Request, email: str = Depends(verify_jwt), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=404, detail="User Not Found")
    
    return {
    "vault_blob": user.vault_blob,
    "iv": user.iv,
    "version": user.vault_version
    }

@router.put("/", response_model=VaultResponse)
async def vault_update(request: Request, req: VaultUpdateRequest, email: str = Depends(verify_jwt), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    if user.vault_version != req.version:
        raise HTTPException(status_code=409, detail="Server Version Conflict")

    user.vault_blob = req.vault_blob
    user.iv = req.iv
    user.vault_version += 1
    await db.commit()
    vault_operations.labels(operation="write", result="success").inc()
    return {
        "vault_blob": user.vault_blob,
        "iv": user.iv,
        "version": user.vault_version
    }

@router.get("/export", response_model=ExportResponse)
async def vault_export(request: Request, email: str = Depends(verify_jwt), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=404, detail="User Not Found")

    return {
        "vault_blob": user.vault_blob,
        "iv": user.iv,
        "salt": user.salt,
        "kdf_params": json.loads(user.kdf_params)
    }

@router.delete("/account", )
async def account_delete(request: Request, email: str = Depends(verify_jwt), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=404, detail="User not Found")

    await db.delete(user)
    await db.commit()

    return {
        "status" : "ok"
    }