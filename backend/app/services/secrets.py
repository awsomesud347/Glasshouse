import os
from dotenv import load_dotenv

load_dotenv()

async def get_secret(key: str) -> str:
    value = os.getenv(key)
    if not value:
        raise RuntimeError(f"Secret '{key}' not found in environment")
    return value