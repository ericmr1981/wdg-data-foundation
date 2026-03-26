#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Generic drift_check

Checks that the project's "map" is not lying: key paths/commands/ports exist.
Designed for **project record roots** (Obsidian project directory).

Usage:
  python3 drift_check.py /path/to/project-root
  python3 drift_check.py /path/to/project-root --json

Exit:
  0 OK
  2 RISK
"""

from __future__ import annotations

import argparse
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path


DEFAULT_TARGET_PORTS = []
DEFAULT_TARGET_PATHS = [
    str(Path.home() / ".openclaw/cron/jobs.json"),
]
DEFAULT_COMMANDS = [
    "oa --version",
]


@dataclass
class Finding:
    level: str  # risk|warn|info
    title: str
    detail: str


def run(cmd: str, timeout: int = 10) -> tuple[int, str, str]:
    p = subprocess.run(["bash", "-lc", cmd], capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("project_root")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--port", action="append", type=int, default=[])
    ap.add_argument("--path", action="append", default=[])
    ap.add_argument("--cmd", action="append", default=[])
    args = ap.parse_args()

    project_root = Path(args.project_root).expanduser().resolve()
    findings: list[Finding] = []

    # Always check project root exists
    if not project_root.exists():
        findings.append(Finding("risk", "project_root does not exist", str(project_root)))
    else:
        findings.append(Finding("info", "project_root exists", str(project_root)))

    # paths: default + overrides
    paths = DEFAULT_TARGET_PATHS + args.path
    for p in paths:
        path = Path(p).expanduser()
        if not path.exists():
            findings.append(Finding("risk", "关键路径不存在", str(path)))
        else:
            findings.append(Finding("info", "关键路径存在", str(path)))

    # commands: default + overrides
    cmds = DEFAULT_COMMANDS + args.cmd
    for c in cmds:
        rc, out, err = run(f"command -v {c.split()[0]} >/dev/null 2>&1 && {c}")
        if rc != 0:
            findings.append(Finding("warn", "命令不可用或执行失败", f"{c}\n{err or out}"))
        else:
            findings.append(Finding("info", "命令OK", f"{c}\n{out}"))

    # ports: best-effort warn if occupied
    ports = DEFAULT_TARGET_PORTS + args.port
    for port in ports:
        rc, out, _ = run(f"lsof -nP -iTCP:{port} -sTCP:LISTEN 2>/dev/null || true")
        if out.strip():
            findings.append(Finding("warn", f"端口 {port} 正在被占用（需确认是否合理）", out.strip()))
        else:
            findings.append(Finding("info", f"端口 {port} 未监听", "OK"))

    risk = [f for f in findings if f.level == "risk"]
    warn = [f for f in findings if f.level == "warn"]
    info = [f for f in findings if f.level == "info"]

    report = {
        "project": str(project_root),
        "counts": {"risk": len(risk), "warn": len(warn), "info": len(info)},
        "risk": [f.__dict__ for f in risk],
        "warn": [f.__dict__ for f in warn],
        "info": [f.__dict__ for f in info],
    }

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print("# Drift Check Report\n")
        print(f"- project: `{report['project']}`")
        print(f"- counts: risk={report['counts']['risk']} warn={report['counts']['warn']} info={report['counts']['info']}\n")

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
        section("WARNINGS", report["warn"])
        section("INFO", report["info"])

    return 2 if len(risk) > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
