import os
from ..core.config import settings
from functools import lru_cache
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


@lru_cache(maxsize=1)
def get_session_factory():
    url = os.getenv("KAVACH_DATABASE_URL", settings.database_url)
    engine = create_engine(url, pool_pre_ping=True)
    return sessionmaker(bind=engine, expire_on_commit=False)
