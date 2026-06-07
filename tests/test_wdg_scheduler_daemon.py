"""
TDD tests for wdg_scheduler_daemon — only the load_jobs_from_db() helper.
The full daemon uses BlockingScheduler + HTTP listener; those are tested manually
in deploy/runbook.
"""
import os
from unittest.mock import patch, MagicMock

import pytest


def test_load_jobs_returns_enabled_only():
    """load_jobs_from_db 只返回 enabled=true 的行"""
    from scripts.wdg_scheduler_daemon import load_jobs_from_db
    fake_rows = [
        (1, 'data_stale', True, '0 9 * * *', None),
        (2, 'monthly_report', False, '0 6 6 * *', None),
        (3, 'unmatched_txn', True, '30 9 * * *', None),
    ]
    with patch('scripts.wdg_scheduler_daemon._query_schedule') as q:
        q.return_value = fake_rows
        jobs = load_jobs_from_db()
    assert len(jobs) == 2
    assert {j['task_name'] for j in jobs} == {'data_stale', 'unmatched_txn'}
    assert all(j['cron_expr'] for j in jobs)


def test_load_jobs_handles_invalid_cron_gracefully():
    """cron 表达式非法 → 跳过该行(不抛)"""
    from scripts.wdg_scheduler_daemon import load_jobs_from_db
    fake_rows = [
        (1, 'data_stale', True, 'INVALID', None),
        (2, 'monthly_report', True, '0 6 6 * *', None),
    ]
    with patch('scripts.wdg_scheduler_daemon._query_schedule') as q:
        q.return_value = fake_rows
        jobs = load_jobs_from_db()
    assert len(jobs) == 1
    assert jobs[0]['task_name'] == 'monthly_report'
