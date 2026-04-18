from pydantic import BaseModel, EmailStr
from typing import Optional

class RegisterInitRequest(BaseModel):
    email: EmailStr

class RegisterInitResponse(BaseModel):
    salt: str
    kdf_params: dict

class RegisterCompleteRequest(BaseModel):
    email: EmailStr
    auth_key: str
    vault_blob: str
    iv: str

class LoginRequest(BaseModel):
    email: EmailStr
    auth_key: str

class LoginResponse(BaseModel):
    token: str
    vault_blob: str
    iv: str
    version: int

class VaultUpdateRequest(BaseModel):
    vault_blob: str
    iv: str
    version: int

class VaultResponse(BaseModel):
    vault_blob: str
    iv: str
    version: int

class ExportResponse(BaseModel):
    vault_blob: str
    iv: str
    salt: str
    kdf_params: dict