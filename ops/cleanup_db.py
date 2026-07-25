"""Clean up database: remove all brands except gelatomiiix"""
import os
import psycopg2

conn = psycopg2.connect(
    host=os.getenv('DB_HOST', 'localhost'), port=os.getenv('DB_PORT', '5432'),
    dbname=os.getenv('DB_NAME', 'dataplatform'), user=os.getenv('DB_USER', 'postgres'),
    password=os.getenv('DB_PASSWORD', 'trust-auth-no-password-needed')
)
conn.autocommit = False
cur = conn.cursor()

try:
    # 1. Drop non-gelatomiiix schemas
    schemas = ['yufeng_cfg', 'yufeng_dm', 'yufeng_ods', 'yufeng_ops',
               'bonjur_cfg', 'bonjur_delivery', 'bonjur_dm', 'bonjur_ods', 'bonjur_ops',
               'xintiandi']
    for s in schemas:
        cur.execute(f'DROP SCHEMA IF EXISTS {s} CASCADE')
        print(f'  Dropped schema: {s}')

    # 2. Clean ops.stores (before brands due to FK)
    cur.execute("DELETE FROM ops.stores WHERE brand_code != 'gelatomiiix'")
    print(f'  Cleaned stores: {cur.rowcount} rows')

    # 3. Clean ops.brands
    cur.execute("DELETE FROM ops.brands WHERE brand_code != 'gelatomiiix'")
    print(f'  Cleaned brands: {cur.rowcount} rows')

    # 4. Clean ops.allowed_schemas
    cur.execute("DELETE FROM ops.allowed_schemas WHERE schema_name NOT LIKE 'brand_gelatomiiix%' AND schema_name NOT IN ('ops', 'raw')")
    print(f'  Cleaned allowed_schemas: {cur.rowcount} rows')

    # 5. Clean ops.bank_rule_map_history
    cur.execute('DELETE FROM ops.bank_rule_map_history')
    print(f'  Cleaned bank_rule_map_history: {cur.rowcount} rows')

    # 6. Clean ops.login_attempts
    cur.execute('DELETE FROM ops.login_attempts')
    print(f'  Cleaned login_attempts: {cur.rowcount} rows')

    # 7. Clean ops.sessions
    cur.execute('DELETE FROM ops.sessions')
    print(f'  Cleaned sessions: {cur.rowcount} rows')

    # 8. Clean ops.pipeline_run + step_run
    cur.execute("""
        DELETE FROM ops.pipeline_step_run
        WHERE run_id IN (
            SELECT run_id FROM ops.pipeline_run WHERE brand_code != 'gelatomiiix'
        )
    """)
    print(f'  Cleaned pipeline_step_run: {cur.rowcount} rows')
    cur.execute("DELETE FROM ops.pipeline_run WHERE brand_code != 'gelatomiiix'")
    print(f'  Cleaned pipeline_run: {cur.rowcount} rows')

    # 9. Clean raw.ingest_file
    cur.execute("DELETE FROM raw.ingest_file WHERE brand_code != 'gelatomiiix'")
    print(f'  Cleaned ingest_file: {cur.rowcount} rows')

    conn.commit()
    print('\n✅ All cleanup completed')
except Exception as e:
    conn.rollback()
    print(f'❌ Error: {e}')
finally:
    cur.close()
    conn.close()
