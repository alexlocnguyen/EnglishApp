from contextlib import contextmanager
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request
from fastapi.routing import APIRoute

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import auth_bff
import main


def make_request(headers: list[tuple[bytes, bytes]] | None = None) -> Request:
    return Request({
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": headers or [],
        "server": ("testserver", 80),
        "client": ("testclient", 50000),
    })


def has_dependency(dependant, expected) -> bool:
    return dependant.call is expected or any(has_dependency(child, expected) for child in dependant.dependencies)


def test_current_user_rejects_missing_credentials():
    with pytest.raises(HTTPException) as error:
        auth_bff.current_user(make_request())

    assert error.value.status_code == 401
    assert error.value.detail == "AUTH_SESSION_REQUIRED"


def test_current_user_rejects_unknown_bearer_session(monkeypatch):
    @contextmanager
    def empty_database():
        yield SimpleNamespace(execute=lambda *_: SimpleNamespace(fetchone=lambda: None))

    monkeypatch.setattr(auth_bff, "_database", empty_database)
    request = make_request([(b"authorization", b"Bearer invalid-session")])

    with pytest.raises(HTTPException) as error:
        auth_bff.current_user(request)

    assert error.value.status_code == 401
    assert error.value.detail == "AUTH_SESSION_EXPIRED"


def test_current_user_resolves_a_valid_session(monkeypatch):
    row = {"uid": "user-1", "email": "learner@example.com", "display_name": "Learner", "created_at": 4_000_000_000}

    @contextmanager
    def session_database():
        yield SimpleNamespace(execute=lambda *_: SimpleNamespace(fetchone=lambda: row))

    monkeypatch.setattr(auth_bff, "_database", session_database)
    request = make_request([(b"authorization", b"Bearer valid-session")])

    assert auth_bff.current_user(request) == {
        "uid": "user-1", "email": "learner@example.com", "displayName": "Learner",
    }


def test_ai_router_applies_session_dependency_to_every_ai_route():
    routes = [route for route in main.ai_router.routes if isinstance(route, APIRoute)]

    assert routes
    assert all(has_dependency(route.dependant, auth_bff.current_user) for route in routes)


def test_learning_routes_also_require_a_session():
    routes = [route for route in main.learning_router.routes if isinstance(route, APIRoute)]

    assert routes
    assert all(has_dependency(route.dependant, auth_bff.current_user) for route in routes)


def test_health_route_remains_public():
    route = next(route for route in main.app.routes if getattr(route, "path", None) == "/api/health")

    assert isinstance(route, APIRoute)
    assert not has_dependency(route.dependant, auth_bff.current_user)
