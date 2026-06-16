"""
TDD tests for verify_helpers — pure functions used by verify_systemd.sh.
"""
import pytest

from scripts.lib.verify_helpers import (
    parse_journalctl_fatal,
    check_url,
    build_health_checks,
    HealthCheck,
)


def test_parse_journalctl_fatal_no_match():
    """无 FATAL → 空列表"""
    assert parse_journalctl_fatal("some info\nmore lines\n") == []


def test_parse_journalctl_fatal_matches_case_insensitive():
    out = parse_journalctl_fatal(
        "INFO ok\nFATAL: data dir corrupted\nWARN low mem\nFATAL: lost connection\n"
    )
    assert out == ["FATAL: data dir corrupted", "FATAL: lost connection"]


def test_check_url_returns_ok():
    """check_url 用回调, 不真发 HTTP — 测试可注入"""
    def fake_curl(url):
        return (200, "ok")
    code, body = check_url("http://127.0.0.1:3000/", curl_fn=fake_curl)
    assert code == 200
    assert body == "ok"


def test_check_url_returns_error():
    def fake_curl(url):
        return (0, "Connection refused")
    code, body = check_url("http://127.0.0.1:3000/", curl_fn=fake_curl)
    assert code == 0


def test_build_health_checks_returns_all_required():
    """verify 必须覆盖 7 项(spec 第 6.4 节)"""
    checks = build_health_checks(db_password="test")
    assert len(checks) == 7
    names = {c.name for c in checks}
    assert "wdg.target active" in names
    assert "agent health" in names
    assert "ui health" in names
    assert "main DB has data" in names
    assert "agent DB has tables" in names
    assert "scheduler health" in names
    assert "no FATAL in PG journal" in names


def test_health_check_str_representation():
    c = HealthCheck(name="x", command=["echo", "ok"])
    assert "x" in str(c)
    assert "echo ok" in str(c)
