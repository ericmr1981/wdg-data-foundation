# tests/test_chat_agent_credentials_ddl.py
import os
import psycopg2
import pytest


@pytest.fixture(scope="module")
def db_conn():
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL not set; skip live DDL test")
    conn = psycopg2.connect(url)
    conn.autocommit = True
    yield conn
    conn.close()


def test_table_exists(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("""
            SELECT 1 FROM information_schema.tables
            WHERE table_schema='ops' AND table_name='chat_agent_credentials'
        """)
        assert cur.fetchone() is not None


def test_default_row_exists(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SELECT model FROM ops.chat_agent_credentials WHERE id = 1")
        row = cur.fetchone()
        assert row is not None
        assert row[0] == "claude-opus-4-8"


def test_columns(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_schema='ops' AND table_name='chat_agent_credentials'
            ORDER BY ordinal_position
        """)
        cols = [r[0] for r in cur.fetchall()]
    assert cols == ['id', 'base_url', 'encrypted_api_key', 'model', 'updated_at', 'updated_by']


def test_primary_key_constraint(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("""
            SELECT 1 FROM information_schema.table_constraints
            WHERE table_schema='ops' AND table_name='chat_agent_credentials'
              AND constraint_type='PRIMARY KEY'
        """)
        assert cur.fetchone() is not None
