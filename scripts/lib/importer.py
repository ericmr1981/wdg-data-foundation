"""
Shared utilities for data import scripts.

Provides:
  - calculate_sha256, get_db_config
  - IngestFileManager for tracking import state
  - ensure_table_exists, delete_imported_data
  - insert_batch (wrapper around execute_values)
  - setup_cli_parser
  - parse_path (path-driven convention)
"""

import argparse
import hashlib
import os
import sys
from pathlib import Path
from typing import Optional

import psycopg2
from psycopg2.extras import execute_values

_SCRIPTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
from _store_guard import load_valid_stores  # noqa: E402


def calculate_sha256(file_path: str) -> str:
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(block)
    return sha256_hash.hexdigest()


def get_db_config() -> dict:
    return {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": os.getenv("DB_PORT", "5432"),
        "database": os.getenv("DB_NAME", "dataplatform"),
        "user": os.getenv("DB_USER", "postgres"),
        "password": os.getenv("DB_PASSWORD"),
    }


def get_connection() -> psycopg2.extensions.connection:
    return psycopg2.connect(**get_db_config())


def setup_cli_parser(
    description: str,
    add_verify: bool = True,
) -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=description)
    ap.add_argument("input", nargs="?", help="Input file or directory")
    ap.add_argument("--dry-run", action="store_true", help="Parse and report without inserting")
    if add_verify:
        ap.add_argument("--verify", action="store_true", help="Verify existing data integrity")
    ap.add_argument("--store-code", help="Override store code (must belong to --brand)")
    ap.add_argument("--brand", help="Brand code override")
    return ap


class IngestFileManager:
    """Tracks file import state in raw.ingest_file."""

    def __init__(self, conn):
        self.conn = conn

    def check(self, file_hash: str, brand_code: Optional[str] = None) -> Optional[dict]:
        with self.conn.cursor() as cur:
            if brand_code:
                cur.execute(
                    "SELECT id, status, row_count FROM raw.ingest_file WHERE file_hash = %s AND brand_code = %s",
                    (file_hash, brand_code),
                )
            else:
                cur.execute(
                    "SELECT id, status, row_count FROM raw.ingest_file WHERE file_hash = %s",
                    (file_hash,),
                )
            row = cur.fetchone()
            return {"id": row[0], "status": row[1], "row_count": row[2]} if row else None

    def create(
        self,
        brand_code: str,
        store_code: str,
        source_type: str,
        month: str,
        file_name: str,
        file_path: str,
        file_hash: str,
        file_size: int,
    ) -> int:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO raw.ingest_file
                  (brand_code, store_code, source_type, month, file_name, file_path, file_hash, file_size, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'pending')
                RETURNING id
                """,
                (brand_code, store_code, source_type, month, file_name, file_path, file_hash, file_size),
            )
            return cur.fetchone()[0]

    def mark_success(self, source_file_id: int, row_count: int):
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE raw.ingest_file SET status='success', row_count=%s, finished_at=CURRENT_TIMESTAMP WHERE id=%s",
                (row_count, source_file_id),
            )
            self.conn.commit()

    def mark_pending(self, source_file_id: int, row_count: int):
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE raw.ingest_file SET status='pending', row_count=%s, finished_at=CURRENT_TIMESTAMP WHERE id=%s",
                (row_count, source_file_id),
            )
            self.conn.commit()

    def mark_failed(self, source_file_id: int, row_count: int = 0):
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE raw.ingest_file SET status='failed', row_count=%s, finished_at=CURRENT_TIMESTAMP WHERE id=%s",
                (row_count, source_file_id),
            )
            self.conn.commit()


def ensure_table_exists(conn, schema: str, table: str, ddl: str):
    """Create table if it doesn't exist. ddl is a CREATE TABLE statement."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema=%s AND table_name=%s)",
            (schema, table),
        )
        if not cur.fetchone()[0]:
            cur.execute(ddl)
            conn.commit()


def delete_imported_data(conn, source_file_id: int, target_table: str, id_column: str = "source_file_id"):
    """Remove rows previously imported by a given source_file_id."""
    with conn.cursor() as cur:
        cur.execute(
            f"DELETE FROM {target_table} WHERE {id_column} = %s",
            (source_file_id,),
        )
        conn.commit()
        return cur.rowcount


def insert_batch(conn, table: str, columns: list[str], values: list[tuple], conflict: Optional[str] = None):
    """Insert rows using execute_values, with optional ON CONFLICT clause."""
    if not values:
        return 0
    with conn.cursor() as cur:
        cols = ", ".join(columns)
        sql = f"INSERT INTO {table} ({cols}) VALUES %s"
        if conflict:
            sql += f" {conflict}"
        execute_values(cur, sql, values)
        conn.commit()
    return len(values)


def parse_path(file_path: str, expected_source_type: str) -> dict:
    """Parse metadata from file path.
    Path format: inputs/{brand_code}/{store_code}/{source_type}/{YYYY-MM}/{filename}
    """
    p = Path(file_path)
    parts = p.parts
    try:
        idx = parts.index("inputs")
    except ValueError:
        raise ValueError(f"Path does not contain 'inputs/' segment: {file_path}")

    brand_code = parts[idx + 1]
    store_code = parts[idx + 2]
    source_type = parts[idx + 3]
    month_str = parts[idx + 4]

    if source_type != expected_source_type:
        raise ValueError(
            f"Unexpected source_type '{source_type}', expected '{expected_source_type}'"
        )

    import re
    if not re.match(r"^\d{4}-\d{2}$", month_str):
        raise ValueError(
            f"月份格式错误 (需 YYYY-MM): {month_str}"
        )

    return {
        "brand_code": brand_code,
        "store_code": store_code,
        "source_type": source_type,
        "month": month_str,
        "month_date": f"{month_str}-01",
        "file_name": p.name,
        "file_path": str(p.resolve()),
    }
