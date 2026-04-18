import os
from dotenv import load_dotenv

load_dotenv()

async def get_secret(key: str) -> str:
    if os.getenv("ENV") == "production":
        # AWS Secrets Manager call goes here later
        raise NotImplementedError("Secrets Manager not yet configured")
    
    value = os.getenv(key)
    if not value:
        raise RuntimeError(f"Secret '{key}' not found in environment")
    return value