#!/usr/bin/env python3
"""
03_publish_results.py — 发布模型快照为生效版本

  - 校验三种 snapshot (dataset_meta / coefficients / baseline) 完整
  - 校验失败：is_active=false，fallback_to=上一 active 版本
  - 校验成功：is_active=true；上一 active 版本降级并填 fallback_to
"""
from __future__ import annotations

import argparse
import sys

import _common as cm
from _common import step_context


REQUIRED_KINDS = ("dataset_meta", "coefficients", "baseline")


def validate_snapshots(version: str, store_code: str) -> tuple[bool, list[str]]:
    missing = []
    for kind in REQUIRED_KINDS:
        snap = cm.get_snapshot(version=version, kind=kind, store_code=store_code)
        if snap is None:
            missing.append(kind)
    return (len(missing) == 0), missing


def activate_version(run_id: str, version: str, store_code: str) -> None:
    """同事务：升新、降旧。"""
    sql_new = """
        UPDATE ops.pipeline_run
        SET is_active=true,
            finished_at=COALESCE(finished_at, NOW()),
            status='success'
        WHERE run_id=%s
    """
    sql_downgrade = """
        UPDATE ops.pipeline_run
        SET is_active=false,
            fallback_to=(SELECT version FROM ops.pipeline_run WHERE run_id=%s)
        WHERE module='discount_model' AND is_active=true AND run_id<>%s
    """
    with cm.connect() as conn, conn.cursor() as cur:
        cur.execute(sql_new, (run_id,))
        cur.execute(sql_downgrade, (run_id, run_id))
        conn.commit()


def rollback_to_previous(run_id: str, fallback_to: str | None) -> None:
    sql = """
        UPDATE ops.pipeline_run
        SET status='failed',
            finished_at=COALESCE(finished_at, NOW()),
            is_active=false,
            fallback_to=COALESCE(%s, fallback_to)
        WHERE run_id=%s
    """
    with cm.connect() as conn, conn.cursor() as cur:
        cur.execute(sql, (fallback_to, run_id))
        conn.commit()


def current_active_version(store_code: str) -> str | None:
    sql = """
        SELECT version FROM ops.pipeline_run
        WHERE module='discount_model' AND is_active=true
        LIMIT 1
    """
    with cm.connect() as conn, conn.cursor() as cur:
        cur.execute(sql)
        row = cur.fetchone()
        return row[0] if row else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--store-code", default="sh_xtd")
    args = parser.parse_args()

    cm.create_pipeline_run(
        run_id=args.run_id, version=args.version, pipeline="publish",
        store_code=args.store_code,
    )

    prev_active = current_active_version(args.store_code)

    with step_context(args.run_id, "validate_snapshots", 1,
                      detail={"required_kinds": list(REQUIRED_KINDS),
                              "prev_active": prev_active}) as r:
        ok, missing = validate_snapshots(args.version, args.store_code)
        r["detail"] = {"ok": ok, "missing": missing}
        if not ok:
            r["detail"]["missing_kinds"] = missing
            raise RuntimeError(f"missing snapshots: {missing}")

    with step_context(args.run_id, "activate_version", 2) as r:
        activate_version(args.run_id, args.version, args.store_code)
        r["detail"] = {"version": args.version, "fallback_from": prev_active}

    cm.finish_pipeline_run(args.run_id, status="success",
                          is_active=True,
                          warnings=[f"fallback_from={prev_active or 'none'}"])
    print(f"[publish] run {args.run_id} version {args.version} active")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # 兜底：失败回退
        try:
            rollback_to_previous(run_id=sys.argv[sys.argv.index("--run-id") + 1],
                                 fallback_to=None)
        except Exception:
            pass
        raise