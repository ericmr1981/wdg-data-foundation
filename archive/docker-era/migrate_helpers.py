"""
Pure functions used by migrate_docker_to_systemd.sh.

只构造 argv 形式的命令, 不真执行 — 实际执行由 shell 脚本完成。
这样命令拼接可以纯测, 不依赖 docker / pg 真的可用。
"""
import subprocess
from typing import List, Optional


def docker_pg_dump_command(
    *, container: str, user: str, db: str, output_path: str
) -> List[str]:
    """构造 docker exec pg_dump 命令。

    输出走 stdout 重定向, 不放命令里 — 命令在 shell 端 redirect。
    """
    return [
        "docker", "exec", container,
        "pg_dump",
        "-U", user,
        db,
        "-Fc",
        "--no-owner",
        "--no-privileges",
    ]


def pg_restore_command(
    *, host: str, port: int, user: str, db: str, dump_path: str, role: str
) -> List[str]:
    """构造 pg_restore 命令 (原生 PG 端)。"""
    return [
        "pg_restore",
        "-h", host,
        "-p", str(port),
        "-U", user,
        "-d", db,
        "--no-owner",
        f"--role={role}",
        dump_path,
    ]


def detect_running_container(name: str, *, docker_ps: Optional[list] = None) -> bool:
    """检查 docker 容器是否在跑。

    docker_ps 参数: 测试时注入。生产调用: 不传, 自己跑 `docker ps`。
    """
    if docker_ps is not None:
        return name in docker_ps
    result = subprocess.run(
        ["docker", "ps", "--format", "{{.Names}}"],
        capture_output=True, text=True, check=False,
    )
    return name in result.stdout.splitlines()
