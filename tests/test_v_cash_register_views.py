"""Driver: connect to remote PG and run each tests/sql/test_v_cash_register_*.sql file.
Uses psycopg2 to execute the SQL and lets DO $$ blocks assert via RAISE EXCEPTION.
If DB_PASSWORD is not set, all tests skip (matches Plan 1 integration test pattern).
"""
import os
from pathlib import Path

import psycopg2
import pytest


SQL_DIR = Path(__file__).resolve().parent / "sql"


def _has_db() -> bool:
    return bool(os.environ.get("DB_PASSWORD"))


def _sql_files():
    """List all .sql files matching test_v_cash_register_*.sql in tests/sql/"""
    return sorted(SQL_DIR.glob("test_v_cash_register_*.sql"))


def _run_sql_file(path: Path):
    """Execute a SQL file and return (stderr captured notice text or None).
    Raises psycopg2.errors.RaiseException if a DO $$ block fails.
    """
    conn = psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", "5432")),
        database=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
    )
    try:
        with conn.cursor() as cur:
            cur.execute(path.read_text())
            conn.commit()
    finally:
        conn.close()


@pytest.mark.integration
@pytest.mark.parametrize("sql_file", _sql_files(), ids=lambda p: p.name)
def test_v_cash_register_view(sql_file):
    if not _has_db():
        pytest.skip("DB_PASSWORD not set — integration test requires remote PG")
    _run_sql_file(sql_file)
