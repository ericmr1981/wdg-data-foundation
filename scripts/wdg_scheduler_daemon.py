"""
WDG Notification Scheduler Daemon
- 启动时从 ops.notification_schedule 读 enabled 行
- 用 APScheduler BlockingScheduler 注册 cron job
- 监听 127.0.0.1:4711 接收 POST /reload 重载
- 每次执行前写 ops.notification_schedule_run (trigger_source='cron')
"""
from __future__ import annotations

import logging
import os
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer

import psycopg2
from apscheduler.schedulers.blocking import BlockingScheduler
from croniter import croniter

# 允许 standalone
# 注意: 不在模块顶层 import run_notification_sweep, 因为它有模块级 DB_CONFIG 访问
# (在没有 DB_PASSWORD 时会抛 KeyError). 改为在 _make_job_func._run 内做延迟 import.

log = logging.getLogger('wdg-scheduler')

# DB config is constructed inside _query_schedule() to allow module import
# without DB_PASSWORD (tests import this module without DB env).

RELOAD_PORT = int(os.getenv('WDG_SCHEDULER_PORT', '4711'))


def _query_schedule() -> list[tuple]:
    """从 DB 读所有 schedule 行 (id, task_name, enabled, cron_expr, brands_filter)"""
    db_config = {
        'host': os.getenv('DB_HOST', 'localhost'),
        'port': int(os.getenv('DB_PORT', '5432')),
        'dbname': os.getenv('DB_NAME', 'dataplatform'),
        'user': os.getenv('DB_USER', 'postgres'),
        'password': os.getenv('DB_PASSWORD', 'trust-auth-no-password-needed'),
    }
    with psycopg2.connect(**db_config) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, task_name, enabled, cron_expr, brands_filter
                FROM ops.notification_schedule
                ORDER BY id
                """
            )
            return list(cur.fetchall())


def load_jobs_from_db() -> list[dict]:
    """
    返回 [{'id', 'task_name', 'cron_expr', 'brands_filter'}, ...]
    跳过 disabled 行 + cron 表达式非法的行。
    """
    jobs = []
    for row in _query_schedule():
        sid, task_name, enabled, cron_expr, brands = row
        if not enabled:
            continue
        try:
            croniter(cron_expr, datetime.now())  # 验证合法
        except Exception as e:
            log.warning('skip invalid cron for %s: %s (expr=%s)', task_name, e, cron_expr)
            continue
        jobs.append({
            'id': sid,
            'task_name': task_name,
            'cron_expr': cron_expr,
            'brands_filter': brands,
        })
    return jobs


def _make_job_func(task_name: str, schedule_id: int, brands: list[str] | None):
    """构造一个 APScheduler job 函数"""
    def _run():
        import run_notification_sweep  # late import to avoid DB_PASSWORD at module load
        argv = ['run_notification_sweep.py', '--task', task_name, '--trigger-source', 'cron']
        if schedule_id:
            argv += ['--schedule-id', str(schedule_id)]
        if brands:
            argv += ['--brands', ','.join(brands)]
        log.info('running sweep: %s', ' '.join(argv))
        sys.argv = argv
        try:
            run_notification_sweep.main()
        except SystemExit:
            pass
        except Exception:
            log.exception('sweep %s failed', task_name)
    return _run


def build_scheduler() -> BlockingScheduler:
    """构造 BlockingScheduler 并按 load_jobs_from_db() 注册 jobs"""
    sched = BlockingScheduler(timezone='Asia/Shanghai')
    for job in load_jobs_from_db():
        brands = job['brands_filter'].split(',') if job['brands_filter'] else None
        sched.add_job(
            _make_job_func(job['task_name'], job['id'], brands),
            'cron',
            **dict(_cron_kwargs(job['cron_expr'])),
            id=f'sweep-{job["task_name"]}',
            replace_existing=True,
        )
    log.info('scheduler loaded %d jobs', len(sched.get_jobs()))
    return sched


def _cron_kwargs(expr: str) -> dict:
    """'分 时 日 月 周' → apscheduler kwargs"""
    parts = expr.split()
    if len(parts) != 5:
        raise ValueError(f'cron must have 5 fields, got: {expr}')
    return {
        'minute': parts[0],
        'hour': parts[1],
        'day': parts[2],
        'month': parts[3],
        'day_of_week': parts[4],
    }


# === HTTP listener for /reload ===

class _ReloadHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/reload':
            log.info('reload requested via HTTP')
            self._ack()
            reload_event.set()
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'ok')
        else:
            self.send_response(404)
            self.end_headers()

    def _ack(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(b'reload scheduled')

    def log_message(self, fmt, *args):
        log.debug(fmt, *args)


reload_event = threading.Event()


def start_reload_listener():
    """启动 HTTP server (daemon thread)"""
    server = HTTPServer(('127.0.0.1', RELOAD_PORT), _ReloadHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True, name='reload-listener')
    t.start()
    log.info('reload listener on http://127.0.0.1:%d', RELOAD_PORT)
    return server


def main():
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s %(levelname)s %(name)s: %(message)s',
    )
    start_reload_listener()
    sched = build_scheduler()
    sched.start()
    log.info('scheduler started; waiting for jobs')

    try:
        while True:
            if reload_event.is_set():
                log.info('reloading scheduler from DB')
                reload_event.clear()
                sched.shutdown(wait=False)
                sched = build_scheduler()
                sched.start()
            time.sleep(5)
    except (KeyboardInterrupt, SystemExit):
        log.info('shutting down')
        sched.shutdown(wait=False)


if __name__ == '__main__':
    main()
