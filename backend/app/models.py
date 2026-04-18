from sqlalchemy import Column, String, Text, Integer, DateTime
from sqlalchemy.sql import func
from app.database import Base
import uuid

class User(Base):
    __tablename__ = "users"

    id            = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email         = Column(String, unique=True, nullable=False, index=True)
    salt          = Column(String, nullable=False)
    kdf_params    = Column(Text, nullable=False)
    verifier      = Column(String, nullable=False)
    vault_blob    = Column(Text, nullable=False)
    iv            = Column(String, nullable=False)
    vault_version = Column(Integer, default=1, nullable=False)
    created_at    = Column(DateTime, server_default=func.now())