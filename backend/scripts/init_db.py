"""
Run this once after MySQL is set up to create all tables.
Usage: python scripts/init_db.py
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.models import models  # noqa — registers all models with Base
from app.models.base import Base, engine

print(f"Connecting to: {engine.url}")
print("Creating tables...")
Base.metadata.create_all(bind=engine)
print("Done. Tables created:")
for table in Base.metadata.sorted_tables:
    print(f"  ✓ {table.name}")
