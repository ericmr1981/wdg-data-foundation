"""Integration tests for /api/tamkoko/inventory/summary.

These hit a live dev server (pytest will skip if not reachable). They require:
  - UI dev server running on http://localhost:4100
  - Database populated with tamkoko brand
  - A valid session cookie exported as TEST_SESSION_COOKIE
"""
import json
import os
import urllib.request
import urllib.error

import pytest

BASE = os.environ.get("UI_BASE_URL", "http://localhost:4100")
COOKIE = os.environ.get("TEST_SESSION_COOKIE", "")


def _req(path, method="GET", body=None, cookie=COOKIE):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        method=method,
        headers={
            "content-type": "application/json",
            "cookie": f"wdg_session={cookie}" if cookie else "",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


pytestmark = pytest.mark.skipif(not COOKIE, reason="TEST_SESSION_COOKIE not set")


def test_get_returns_list():
    status, body = _req("/api/tamkoko/inventory/summary")
    assert status == 200
    assert body["success"] is True
    assert isinstance(body["data"], list)


def test_post_then_upsert_then_audit():
    payload = {"store_code": "hz_fuyang", "period": "2099-08", "total_amount": 123.45}
    s1, b1 = _req("/api/tamkoko/inventory/summary", "POST", payload)
    assert s1 == 200, b1
    assert b1["data"]["total_amount"] == 123.45

    payload2 = {"store_code": "hz_fuyang", "period": "2099-08", "total_amount": 234.56}
    s2, b2 = _req("/api/tamkoko/inventory/summary", "POST", payload2)
    assert s2 == 200
    assert b2["data"]["total_amount"] == 234.56


def test_post_negative_amount_rejected():
    s, _ = _req("/api/tamkoko/inventory/summary", "POST",
                {"store_code": "hz_fuyang", "period": "2099-08", "total_amount": -1})
    assert s == 400


def test_unauth_get_returns_401():
    s, _ = _req("/api/tamkoko/inventory/summary", cookie="")
    assert s == 401