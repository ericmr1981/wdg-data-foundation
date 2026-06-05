# tests/test_chat_ddl.py
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


def _columns(db_conn, table_name):
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema='ops' AND table_name=%s
            """,
            (table_name,),
        )
        return {row[0]: row[1] for row in cur.fetchall()}


def test_chat_session_log_columns(db_conn):
    cols = _columns(db_conn, "chat_session_log")
    expected = {
        "id", "user_id", "started_at", "ended_at",
        "message_count", "tool_call_count",
        "input_tokens", "output_tokens", "cost_usd",
    }
    assert set(cols.keys()) == expected


def test_chat_tool_call_columns(db_conn):
    cols = _columns(db_conn, "chat_tool_call")
    expected = {
        "id", "session_id", "tool_name", "tool_input",
        "tool_result_summary", "is_error", "duration_ms", "called_at",
    }
    assert set(cols.keys()) == expected


def test_chat_tool_call_tool_input_is_jsonb(db_conn):
    cols = _columns(db_conn, "chat_tool_call")
    assert cols["tool_input"] == "jsonb"


def test_chat_session_log_cost_usd_is_numeric(db_conn):
    cols = _columns(db_conn, "chat_session_log")
    assert cols["cost_usd"] == "numeric"


def test_chat_tool_call_fk_target_and_action(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              ccu.table_schema || '.' || ccu.table_name || '(' || ccu.column_name || ')' AS target,
              rc.delete_rule
            FROM information_schema.referential_constraints rc
            JOIN information_schema.key_column_usage kcu
              ON kcu.constraint_name = rc.constraint_name
             AND kcu.table_schema = rc.constraint_schema
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = rc.unique_constraint_name
             AND ccu.table_schema = rc.unique_constraint_schema
            WHERE kcu.table_schema='ops' AND kcu.table_name='chat_tool_call'
            """
        )
        row = cur.fetchone()
    assert row is not None, "chat_tool_call should have a FK"
    target, delete_rule = row
    assert target == "ops.chat_session_log(id)"
    assert delete_rule == "RESTRICT"


def test_chat_indexes_exist(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT indexname FROM pg_indexes
            WHERE schemaname='ops'
              AND indexname IN ('idx_chat_tool_call_session', 'idx_chat_session_log_user')
            """
        )
        names = {row[0] for row in cur.fetchall()}
    assert names == {"idx_chat_tool_call_session", "idx_chat_session_log_user"}
