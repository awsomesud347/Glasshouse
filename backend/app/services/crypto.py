from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from jose import jwt, JWTError
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer
from app.services.secrets import get_secret
from datetime import datetime, timedelta
import secrets

ph = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=1
)

security = HTTPBearer()

async def hash_auth_key(auth_key: str) -> str:
    pepper = await get_secret("PEPPER")
    return ph.hash(auth_key + pepper)

async def verify_auth_key(stored_verifier: str, auth_key: str) -> bool:
    pepper = await get_secret("PEPPER")
    try:
        ph.verify(stored_verifier, auth_key + pepper)
        return True
    except VerifyMismatchError:
        return False

async def create_token(email: str) -> str:
    jwt_secret = await get_secret("JWT_SECRET")
    payload = {
        "sub": email,
        "exp": datetime.utcnow() + timedelta(hours=1),
        "jti": secrets.token_hex(16)
    }
    return jwt.encode(payload, jwt_secret, algorithm="HS256")

async def verify_jwt(credentials = Depends(security)) -> str:
    jwt_secret = await get_secret("JWT_SECRET")
    try:
        payload = jwt.decode(
            credentials.credentials,
            jwt_secret,
            algorithms=["HS256"]
        )
        email = payload.get("sub")
        if not email:
            raise HTTPException(status_code=401, detail="Invalid token")
        return email
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")