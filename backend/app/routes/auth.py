from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import User
from app.schemas import (
    RegisterInitRequest, RegisterInitResponse,
    RegisterCompleteRequest, LoginRequest, LoginResponse
)
from app.services.crypto import hash_auth_key, verify_auth_key, create_token
import secrets
import json

router = APIRouter(prefix="/auth", tags=["auth"])

KDF_PARAMS = {
    "algorithm": "argon2id",
    "memory": 65536,
    "iterations": 3,
    "parallelism": 1
}

@router.post("/register/init", response_model=RegisterInitResponse)
async def register_init(req: RegisterInitRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == req.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    
    salt = secrets.token_hex(32)
    return {"salt": salt, "kdf_params": KDF_PARAMS}

@router.post("/register/complete")
async def register_complete(req: RegisterCompleteRequest, db: AsyncSession = Depends(get_db)):
    print(f"REGISTER auth_key: {req.auth_key[:20]}...")
    result = await db.execute(select(User).where(User.email == req.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    verifier = await hash_auth_key(req.auth_key)

    user = User(
        email=req.email,
        salt=req.salt,
        kdf_params=json.dumps(KDF_PARAMS),
        verifier=verifier,
        vault_blob=req.vault_blob,
        iv=req.iv
    )
    db.add(user)
    await db.commit()
    return {"status": "ok"}

@router.get("/salt")
async def get_salt(email: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        return {"salt": secrets.token_hex(32), "kdf_params": KDF_PARAMS}
    return {"salt": user.salt, "kdf_params": json.loads(user.kdf_params)}

@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    print(f"LOGIN auth_key: {req.auth_key[:20]}...")
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    print(f"USER found: {user is not None}")

    if not user or not await verify_auth_key(user.verifier, req.auth_key):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = await create_token(user.email)
    return {
        "token": token,
        "vault_blob": user.vault_blob,
        "iv": user.iv,
        "version": user.vault_version
    }