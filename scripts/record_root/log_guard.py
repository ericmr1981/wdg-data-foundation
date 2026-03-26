#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Generic log_guard

Purpose: catch the non-PR/direct-edit failure mode: files changed but ProjectTasks.md wasn't updated.

Heuristic:
- Find latest mtime among files (excluding ProjectTasks.md)
- If ProjectTasks.md mtime lags by > toleranceSeconds → RISK

Usage:
  python3 log_guard.py /path/to/project-root
  python3 log_guard.py /path/to/project-root --json

Exit:
  0 OK
  2 RISK
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path


DEFAULT_TOLERANCE_SECONDS = 180


@dataclass
class Finding:
    level: str  # risk|info
    title: str
    detail: str


def iter_files(root: Path):
    for p in root.rglob("*"):
        if p.is_dir():
            continue
        if p.name in {".DS_Store"}:
            continue
        yield p


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("project_root")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--tolerance", type=int, default=DEFAULT_TOLERANCE_SECONDS)
    args = ap.parse_args()

    root = Path(args.project_root).expanduser().resolve()
    tasks = root / "ProjectTasks.md"

    findings: list[Finding] = []
    if not tasks.exists():
        findings.append(Finding("risk", "ProjectTasks.md missing", str(tasks)))
    else:
        tasks_mtime = tasks.stat().st_mtime
        latest_other = None
        for p in iter_files(root):
            if p.resolve() == tasks.resolve():
                continue
            mt = p.stat().st_mtime
            if latest_other is None or mt > latest_other[0]:
                latest_other = (mt, p)

        if latest_other is None:
            findings.append(Finding("info", "no other files", "OK"))
        else:
            latest_mt, latest_path = latest_other
            delta = latest_mt - tasks_mtime
            if delta > args.tolerance:
                findings.append(Finding(
                    "risk",
                    "ProjectTasks.md appears behind latest change",
                    f"latest_change={latest_path} delta={int(delta)}s tolerance={args.tolerance}s",
                ))
            else:
                findings.append(Finding(
                    "info",
                    "ProjectTasks.md is in sync (within tolerance)",
                    f"latest_change={latest_path} delta={int(delta)}s tolerance={args.tolerance}s",
                ))

    risk = [f for f in findings if f.level == "risk"]
    info = [f for f in findings if f.level == "info"]
    report = {
        "project": str(root),
        "toleranceSeconds": args.tolerance,
        "counts": {"risk": len(risk), "info": len(info)},
        "risk": [f.__dict__ for f in risk],
        "info": [f.__dict__ for f in info],
    }

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print("# Log Guard Report\n")
        print(f"- project: `{report['project']}`")
        print(f"- toleranceSeconds: {args.tolerance}")
        print(f"- counts: risk={report['counts']['risk']} info={report['counts']['info']}\n")

        def section(name: str, items: list[dict]):
            print(f"## {name} ({len(items)})\n")
            if not items:
                print("- (none)\n")
                return
            for it in items:
                print(f"- **{it['title']}**")
                detail = (it.get("detail") or "").replace("\n", "\n  ")
                if detail:
                    print(f"  - {detail}")
            print("")

        section("RISKS", report["risk"])
        section("INFO", report["info"])

    return 2 if len(risk) > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
