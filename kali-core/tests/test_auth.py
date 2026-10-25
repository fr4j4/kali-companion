"""Security tests: auth middleware + WS challenge (S1 of hardening)."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from kali_core.auth import WS_AUTH_EVENT, install_auth, ws_token_ok

TOKEN = "test-token-123"


@pytest.fixture()
def app_with_token() -> FastAPI:
    app = FastAPI()
    install_auth(app, TOKEN, open_paths={"/health"})

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.get("/secure")
    def secure():
        return {"data": 1}

    return app


@pytest.fixture()
def app_no_auth() -> FastAPI:
    app = FastAPI()
    install_auth(app, "", open_paths={"/health"})

    @app.get("/secure")
    def secure():
        return {"ok": True}

    return app


def test_http_rejects_missing_token(app_with_token):
    client = TestClient(app_with_token)
    resp = client.get("/secure")
    assert resp.status_code == 401


def test_http_rejects_wrong_token(app_with_token):
    client = TestClient(app_with_token)
    resp = client.get("/secure", headers={"Authorization": "Bearer nope"})
    assert resp.status_code == 401


def test_http_accepts_bearer(app_with_token):
    client = TestClient(app_with_token)
    resp = client.get("/secure", headers={"Authorization": f"Bearer {TOKEN}"})
    assert resp.status_code == 200


def test_http_accepts_x_api_token(app_with_token):
    client = TestClient(app_with_token)
    resp = client.get("/secure", headers={"X-API-Token": TOKEN})
    assert resp.status_code == 200


def test_health_stays_open(app_with_token):
    client = TestClient(app_with_token)
    assert client.get("/health").status_code == 200


def test_no_auth_when_token_empty(app_no_auth):
    client = TestClient(app_no_auth)
    assert client.get("/secure").status_code == 200


def test_ws_token_ok_constant_time():
    assert ws_token_ok(TOKEN, TOKEN)
    assert not ws_token_ok("nope", TOKEN)
    assert not ws_token_ok(None, TOKEN)
    assert not ws_token_ok(123, TOKEN)


def test_ws_token_ok_with_empty_expected():
    # Empty expected token = auth disabled.
    assert ws_token_ok("anything", "")