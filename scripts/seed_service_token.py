#!/usr/bin/env python3
"""
Seed or rotate the 'sweep-notification' service token.
Prints the raw token ONCE on stdout. DB stores only SHA-256 hash.
Re-running rotates the token (new raw, new hash).
"""
import hashlib
import os
import secrets
import sys

import psycopg2

DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': int(os.getenv('DB_PORT', '5432')),
    'dbname': os.getenv('DB_NAME', 'dataplatform'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', 'trust-auth-no-password-needed'),
}


def main():
    raw = secrets.token_urlsafe(32)  # 43-char URL-safe random string
    h = hashlib.sha256(raw.encode()).hexdigest()
    conn = psycopg2.connect(**DB_CONFIG)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ops.service_token (name, token_hash, enabled)
            VALUES ('sweep-notification', %s, true)
            ON CONFLICT (name) DO UPDATE
            SET token_hash = EXCLUDED.token_hash,
                enabled = true,
                created_at = now()
            """,
            (h,),
        )
    conn.commit()
    conn.close()
    print('========================================================')
    print('SERVICE TOKEN CREATED (will NOT be shown again):')
    print(f'  WDG_SERVICE_TOKEN={raw}')
    print('========================================================')
    print('Save this in /opt/wdg/.env (or your secret manager).')


if __name__ == '__main__':
    main()
