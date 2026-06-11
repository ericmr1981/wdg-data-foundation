"""
初始化 ops.notification_schedule 的 4 行默认配置。
已存在则更新 enabled/cron_expr/brands_filter/description。
注意: 本脚本不主动 bump updated_at(需在 API 层手动维护)。
"""
import os
import sys
import psycopg2

DEFAULT_ROWS = [
    ('data_stale',       True,  '0 9 * * *',   None,                            '每日 09:00 跑数据新鲜度检查'),
    ('unmatched_txn',    True,  '30 9 * * *',  None,                            '每日 09:30 跑未配条目检查'),
    ('dup_rule',         True,  '30 9 * * *',  None,                            '每日 09:30 跑重复规则检查'),
    ('monthly_report',   True,  '0 6 6 * *',   None,                            '每月 6 日 06:00 跑月报生成'),
]

CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': int(os.getenv('DB_PORT', '5432')),
    'dbname': os.getenv('DB_NAME', 'dataplatform'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.environ['DB_PASSWORD'],
}


def main():
    conn = psycopg2.connect(**CONFIG)
    with conn.cursor() as cur:
        for task, enabled, cron, brands, desc in DEFAULT_ROWS:
            cur.execute(
                """
                INSERT INTO ops.notification_schedule
                    (task_name, enabled, cron_expr, brands_filter, description)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (task_name) DO UPDATE
                SET enabled = EXCLUDED.enabled,
                    cron_expr = EXCLUDED.cron_expr,
                    brands_filter = EXCLUDED.brands_filter,
                    description = EXCLUDED.description
                """,
                (task, enabled, cron, brands, desc),
            )
    conn.commit()
    conn.close()
    print(f'Seeded {len(DEFAULT_ROWS)} rows into ops.notification_schedule')


if __name__ == '__main__':
    main()
