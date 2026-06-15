"""
TDD tests for install_helpers — pure functions used by install_systemd.sh.
"""
import pytest

from scripts.lib.install_helpers import (
    detect_pg_version,
    pg_hba_local_md5_line,
    postgres_conf_overrides,
    initdb_command,
    env_file_contents,
)


def test_detect_pg_version_from_binpath():
    """从 /usr/lib/postgresql/<ver>/bin/postgres 路径里抠出版本号"""
    assert detect_pg_version("/usr/lib/postgresql/16/bin/postgres") == "16"
    assert detect_pg_version("/usr/lib/postgresql/15/bin/postgres") == "15"


def test_detect_pg_version_invalid_path_raises():
    with pytest.raises(ValueError, match="Cannot detect PG version"):
        detect_pg_version("/usr/bin/postgres")


def test_pg_hba_local_md5_line_format():
    """生成 127.0.0.1/32 md5 鉴权行"""
    line = pg_hba_local_md5_line()
    assert line == "host all all 127.0.0.1/32 md5"


def test_postgres_conf_overrides_main():
    """主 PG 配置覆盖: 5432 + 127.0.0.1"""
    out = postgres_conf_overrides(port=5432)
    assert "listen_addresses = '127.0.0.1'" in out
    assert "port = 5432" in out
    assert "unix_socket_directories = '/var/run/postgresql'" in out


def test_postgres_conf_overrides_agent():
    """agent test DB 端口 5433"""
    out = postgres_conf_overrides(port=5433)
    assert "port = 5433" in out


def test_initdb_command_basic():
    cmd = initdb_command(
        pg_bin="/usr/lib/postgresql/16/bin",
        data_dir="/var/lib/postgresql/16/main",
        encoding="UTF8",
        locale="C",
    )
    assert cmd[0] == "sudo"
    assert cmd[1] == "-u"
    assert cmd[2] == "postgres"
    assert cmd[3] == "/usr/lib/postgresql/16/bin/initdb"
    assert "-D" in cmd
    assert "/var/lib/postgresql/16/main" in cmd
    assert "--encoding=UTF8" in cmd
    assert "--locale=C" in cmd


def test_env_file_contents_main():
    """主 PG 的 env 文件内容"""
    content = env_file_contents(role="main", pg_data="/var/lib/postgresql/16/main", pg_port=5432)
    assert "PGDATA=/var/lib/postgresql/16/main" in content
    assert "PGPORT=5432" in content


def test_env_file_contents_agent():
    content = env_file_contents(role="agent", pg_data="/var/lib/postgresql/16/agent_main", pg_port=5433)
    assert "PGDATA=/var/lib/postgresql/16/agent_main" in content
    assert "PGPORT=5433" in content
