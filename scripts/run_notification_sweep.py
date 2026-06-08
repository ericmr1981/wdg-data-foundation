"""
sweep 入口 CLI。
用法:
  python scripts/run_notification_sweep.py --task data_stale
  python scripts/run_notification_sweep.py --task data_stale,unmatched_txn
  python scripts/run_notification_sweep.py --task all --brands tamkoko,gelatomiiix
  python scripts/run_notification_sweep.py --task all --dry-run
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime

import psycopg2

# 允许 standalone 调用
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from notification_sweep import (  # noqa: E402
    sweep_data_stale,
    sweep_unmatched_txn,
    sweep_dup_rule,
    sweep_monthly_report,
)

TASKS = {
    'data_stale': sweep_data_stale,
    'unmatched_txn': sweep_unmatched_txn,
    'dup_rule': sweep_dup_rule,
    'monthly_report': sweep_monthly_report,
}

DEFAULT_DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': int(os.getenv('DB_PORT', '5432')),
    'dbname': os.getenv('DB_NAME', 'dataplatform'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.environ['DB_PASSWORD'],
}


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--task', required=True,
                   help='data_stale | unmatched_txn | dup_rule | monthly_report | all (CSV)')
    p.add_argument('--brands', default=None,
                   help='CSV brand codes; default = all from BRAND_SOURCE_MAP')
    p.add_argument('--trigger-source', default='manual',
                   choices=['manual', 'cron', 'reload'])
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--schedule-id', type=int, default=None)
    p.add_argument('-v', '--verbose', action='store_true')
    return p.parse_args()


def main():
    args = parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format='%(asctime)s %(levelname)s %(name)s: %(message)s',
    )
    log = logging.getLogger('sweep')

    task_names = list(TASKS) if args.task == 'all' else args.task.split(',')
    for t in task_names:
        if t not in TASKS:
            print(f'Unknown task: {t}', file=sys.stderr)
            return 2

    brands = args.brands.split(',') if args.brands else None
    conn = psycopg2.connect(**DEFAULT_DB_CONFIG)
    conn.autocommit = False

    results: dict[str, int] = {}  # task_name -> new notifications
    failures: list[tuple[str, str]] = []  # (task_name, error_message)

    try:
        for t in task_names:
            started = datetime.now()
            run_id = None
            if not args.dry_run:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO ops.notification_schedule_run
                            (schedule_id, task_name, started_at, status, trigger_source)
                        VALUES (%s, %s, %s, 'running', %s) RETURNING id
                        """,
                        (args.schedule_id, t, started, args.trigger_source),
                    )
                    run_id = cur.fetchone()[0]
                conn.commit()

            try:
                n = TASKS[t](conn, brands=brands)
                results[t] = n
                log.info('sweep %s done: %d new notifications', t, n)
                if not args.dry_run and run_id:
                    finished = datetime.now()
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE ops.notification_schedule_run
                            SET finished_at = %s, status = 'success', new_notifications = %s
                            WHERE id = %s
                            """,
                            (finished, n, run_id),
                        )
                    conn.commit()
            except Exception as e:
                log.exception('sweep %s failed', t)
                err = str(e)[:500]
                failures.append((t, err))
                if not args.dry_run and run_id:
                    finished = datetime.now()
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE ops.notification_schedule_run
                            SET finished_at = %s, status = 'failed', error_message = %s
                            WHERE id = %s
                            """,
                            (finished, err, run_id),
                        )
                    conn.commit()
    finally:
        conn.close()

    total = sum(results.values())
    print(f'Total: {total} new notifications')
    if failures:
        print(f'{len(failures)} task(s) failed:', file=sys.stderr)
        for t, err in failures:
            print(f'  {t}: {err}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
