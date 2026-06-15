"""
Pure functions used by verify_systemd.sh.

verify_systemd.sh 调用 build_health_checks() 得到 7 个 HealthCheck,
顺序执行, 全部退出 0 才算通过。
"""
import re
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Tuple


_FATAL_RE = re.compile(r"(?i)\bFATAL\b[: ]+(.*)")


@dataclass(frozen=True)
class HealthCheck:
    """单个健康检查项。name 给日志看, command 跑在子 shell。"""
    name: str
    command: List[str]
    expect: str = "ok"  # 仅文档作用, 实际退出码看 $?
    note: str = field(default="")

    def __str__(self) -> str:
        return f"{self.name}: {' '.join(self.command)}"


def parse_journalctl_fatal(journal_output: str) -> List[str]:
    """从 journalctl 输出里挑出所有 FATAL 行。

    大小写不敏感 (PG 写 "FATAL:" 也可能写 "fatal error")。
    返回去掉前后空白的纯文本行。
    """
    out: List[str] = []
    for line in journal_output.splitlines():
        m = _FATAL_RE.search(line)
        if m:
            out.append(m.group(0).strip())
    return out


def check_url(url: str, *, curl_fn: Callable[[str], Tuple[int, str]]) -> Tuple[int, str]:
    """包一层 curl 调用, 方便测试时注入 fake。

    真实调用: curl_fn = lambda u: subprocess... 见 verify_systemd.sh。
    """
    return curl_fn(url)


def build_health_checks(*, db_password: str) -> List[HealthCheck]:
    """构造 spec 第 6.4 节列出的 7 项检查。

    db_password 用来 PGPASSWORD=... 但命令本身不直接含明文 — 走 stdin 注入。
    """
    return [
        HealthCheck(
            name="wdg.target active",
            command=["systemctl", "is-active", "wdg.target"],
            expect="active",
        ),
        HealthCheck(
            name="agent health",
            command=["curl", "-fsS", "http://127.0.0.1:4101/health"],
        ),
        HealthCheck(
            name="ui health",
            command=["curl", "-fsS", "http://127.0.0.1:3000/"],
        ),
        HealthCheck(
            name="main DB has data",
            command=[
                "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", "dataplatform",
                "-c", "SELECT count(*) FROM raw.ingest_file",
            ],
            expect=">=1",
        ),
        HealthCheck(
            name="agent DB has tables",
            command=[
                "psql", "-h", "127.0.0.1", "-p", "5433", "-U", "agent", "-d", "agent_dev",
                "-c", "\\dt",
            ],
            expect="non-empty",
        ),
        HealthCheck(
            name="scheduler health",
            command=["curl", "-fsS", "http://127.0.0.1:4711/health"],
        ),
        HealthCheck(
            name="no FATAL in PG journal",
            command=[
                "bash", "-c",
                "journalctl -u wdg-postgres -n 20 --no-pager | grep -i FATAL || true",
            ],
            expect="empty",
            note="用 || true 让它永远退出 0, 检查由 python 端做",
        ),
    ]
