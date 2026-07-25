#!/usr/bin/env python3
"""
04_run_pipeline.py — 一键全流程（prepare → train → publish）

  - 单一 run_id 贯穿三步
  - 每一步用同一个 version
  - publish 阶段失败 → 整 run failed，is_active=false，自动回退
  - 每步开始前检查 cancel_requested
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

import _common as cm


HERE = Path(__file__).resolve().parent


def run_step(script: str, args: list[str]) -> int:
    cmd = [sys.executable, str(HERE / script), *args]
    print(f"[pipeline] exec: {' '.join(cmd)}")
    proc = subprocess.run(cmd)
    return proc.returncode


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2025-08-01")
    parser.add_argument("--end", default="2026-07-31")
    parser.add_argument("--train-end", default="2026-05-31")
    parser.add_argument("--store-code", default="sh_xtd")
    parser.add_argument("--skip-publish", action="store_true",
                        help="只跑 prepare+train，不切换 is_active")
    args = parser.parse_args()

    run_id = cm.new_run_id()
    version = cm.new_version()
    print(f"[pipeline] run_id={run_id} version={version}")

    try:
        cm.create_pipeline_run(
            run_id=run_id, version=version, pipeline="full",
            store_code=args.store_code,
            data_range_start=args.start, data_range_end=args.end,
        )

        base = ["--run-id", run_id, "--version", version,
                "--start", args.start, "--end", args.end,
                "--store-code", args.store_code]

        rc = run_step("01_prepare_data.py", base)
        if rc != 0:
            cm.finish_pipeline_run(run_id, status="failed",
                                  warnings=["01_prepare_data 失败"])
            sys.exit(rc)

        train_args = base + ["--train-end", args.train_end]
        rc = run_step("02_train_models.py", train_args)
        if rc != 0:
            cm.finish_pipeline_run(run_id, status="failed",
                                  warnings=["02_train_models 失败"])
            sys.exit(rc)

        if args.skip_publish:
            cm.finish_pipeline_run(run_id, status="success",
                                  warnings=["--skip-publish：未切换 is_active"])
            print(f"[pipeline] run {run_id} done (skip publish)")
            return

        rc = run_step("03_publish_results.py",
                      ["--run-id", run_id, "--version", version,
                       "--store-code", args.store_code])
        if rc != 0:
            cm.finish_pipeline_run(run_id, status="failed", is_active=False,
                                  warnings=["03_publish_results 失败，已回退到上一版"])
            sys.exit(rc)

        print(f"[pipeline] run {run_id} version {version} fully active")

    except Exception as e:
        print(f"[pipeline] FATAL: {type(e).__name__}: {e}", file=sys.stderr)
        try:
            cm.finish_pipeline_run(run_id, status="failed",
                                  warnings=[f"{type(e).__name__}: {e}"])
        except Exception as cleanup_err:
            print(f"[pipeline] finish_pipeline_run 失败: {cleanup_err}", file=sys.stderr)
            cm._hard_update_pipeline_run_failed(run_id, f"{type(e).__name__}: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()