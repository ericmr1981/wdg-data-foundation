"""
TDD tests for migrate_helpers — builds pg_dump / pg_restore commands.
"""
import pytest

from scripts.lib.migrate_helpers import (
    docker_pg_dump_command,
    pg_restore_command,
    detect_running_container,
)


def test_docker_pg_dump_command_main():
    """主库 dump: docker exec 进 dataplatform-pg-dashboard"""
    cmd = docker_pg_dump_command(
        container="dataplatform-pg-dashboard",
        user="postgres",
        db="dataplatform",
        output_path="/tmp/wdg_main.dump",
    )
    assert cmd[:5] == ["docker", "exec", "dataplatform-pg-dashboard", "pg_dump", "-U"]
    assert cmd[5] == "postgres"
    assert cmd[6] == "dataplatform"
    assert "-Fc" in cmd
    assert "--no-owner" in cmd
    assert "--no-privileges" in cmd
    # 输出走 stdout 重定向, 不在命令里
    assert "/tmp/wdg_main.dump" not in cmd


def test_docker_pg_dump_command_agent():
    cmd = docker_pg_dump_command(
        container="wdg-agent-test-db",
        user="agent",
        db="agent_dev",
        output_path="/tmp/wdg_agent.dump",
    )
    assert "wdg-agent-test-db" in cmd
    assert cmd[5] == "agent"
    assert cmd[6] == "agent_dev"


def test_pg_restore_command_main():
    cmd = pg_restore_command(
        host="127.0.0.1",
        port=5432,
        user="postgres",
        db="dataplatform",
        dump_path="/tmp/wdg_main.dump",
        role="postgres",
    )
    assert cmd[0:2] == ["pg_restore", "-h"]
    assert "127.0.0.1" in cmd
    assert "-p" in cmd
    assert "5432" in cmd
    assert "--no-owner" in cmd
    assert "--role=postgres" in cmd
    assert "/tmp/wdg_main.dump" in cmd


def test_pg_restore_command_agent_uses_5433():
    cmd = pg_restore_command(
        host="127.0.0.1",
        port=5433,
        user="agent",
        db="agent_dev",
        dump_path="/tmp/wdg_agent.dump",
        role="agent",
    )
    assert "5433" in cmd
    assert "--role=agent" in cmd


def test_detect_running_container_present(monkeypatch):
    """docker ps 出来包含目标容器名 → 返回 True"""
    monkeypatch.setattr(
        "subprocess.run",
        lambda *a, **kw: type("R", (), {"stdout": "dataplatform-pg-dashboard\nfoo\n", "returncode": 0})(),
    )
    assert detect_running_container("dataplatform-pg-dashboard") is True


def test_detect_running_container_absent(monkeypatch):
    monkeypatch.setattr(
        "subprocess.run",
        lambda *a, **kw: type("R", (), {"stdout": "foo\nbar\n", "returncode": 0})(),
    )
    assert detect_running_container("dataplatform-pg-dashboard") is False
