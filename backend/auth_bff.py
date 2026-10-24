"""Backend-for-Frontend authentication backed by Firebase Identity Toolkit."""

from __future__ import annotations

import hashlib
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

router = APIRouter(prefix="/api/auth", tags=["authentication"])
IDENTITY_API = "https://identitytoolkit.googleapis.com/v1/accounts"
TOKEN_API = "https://securetoken.googleapis.com/v1/token"
COOKIE_NAME = "elevate_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30


class BffSettings(BaseSettings):
    firebase_api_key: str = ""
    auth_session_encryption_key: str = ""
    auth_session_db_path: str = ""
    app_env: str = "development"
    bff_cookie_samesite: str = "lax"
    cors_origins: str = "http://localhost:8081,http://127.0.0.1:8081"
    model_config = SettingsConfigDict(env_file=Path(__file__).with_name(".env"), extra="ignore")


bff_settings = BffSettings()


class CredentialsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=6, max_length=128)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        if "@" not in value or value.startswith("@") or value.endswith("@"):
            raise ValueError("A valid email address is required")
        return value.lower()


class RegistrationRequest(CredentialsRequest):
    display_name: str = Field(min_length=1, max_length=80)


class PasswordResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    email: str = Field(min_length=3, max_length=254)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        if "@" not in value or value.startswith("@") or value.endswith("@"):
            raise ValueError("A valid email address is required")
        return value.lower()


def _api_key() -> str:
    value = bff_settings.firebase_api_key.strip()
    if not value:
        raise HTTPException(status_code=503, detail="FIREBASE_AUTH_NOT_CONFIGURED")
    return value


def _fernet() -> Fernet:
    value = bff_settings.auth_session_encryption_key.strip()
    if not value:
        raise HTTPException(status_code=503, detail="AUTH_SESSION_NOT_CONFIGURED")
    try:
        return Fernet(value.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise HTTPException(status_code=503, detail="AUTH_SESSION_NOT_CONFIGURED") from exc


def _database_path() -> Path:
    configured = bff_settings.auth_session_db_path.strip()
    return Path(configured) if configured else Path(__file__).parent / "data" / "auth_sessions.sqlite3"


def _connect() -> sqlite3.Connection:
    path = _database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute(
        """CREATE TABLE IF NOT EXISTS auth_sessions (
            token_hash TEXT PRIMARY KEY,
            uid TEXT NOT NULL,
            email TEXT NOT NULL,
            display_name TEXT NOT NULL,
            refresh_token TEXT NOT NULL,
            id_token TEXT NOT NULL,
            token_expires_at REAL NOT NULL,
            created_at REAL NOT NULL
        )"""
    )
    return connection


@contextmanager
def _database():
    connection = _connect()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _session_credential(request: Request) -> str | None:
    bearer = request.headers.get("authorization", "")
    if bearer.lower().startswith("bearer "):
        return bearer[7:].strip() or None
    return request.cookies.get(COOKIE_NAME)


def current_user(request: Request) -> dict[str, str]:
    """Resolve the BFF session into a stable Firebase identity for API routes."""
    token = _session_credential(request)
    if not token:
        raise HTTPException(status_code=401, detail="AUTH_SESSION_REQUIRED")
    with _database() as connection:
        row = connection.execute(
            "SELECT uid,email,display_name,created_at FROM auth_sessions WHERE token_hash = ?",
            (_token_hash(token),),
        ).fetchone()
    if row is None or row["created_at"] + SESSION_MAX_AGE <= time.time():
        raise HTTPException(status_code=401, detail="AUTH_SESSION_EXPIRED")
    return {"uid": row["uid"], "email": row["email"], "displayName": row["display_name"]}


def _check_browser_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    allowed = {item.strip() for item in bff_settings.cors_origins.split(",")}
    is_web_client = request.headers.get("x-elevate-client") == "web"
    if (is_web_client and not origin) or (origin and origin not in allowed):
        raise HTTPException(status_code=403, detail="AUTH_ORIGIN_NOT_ALLOWED")


async def _firebase_request(path: str, payload: dict[str, Any], *, form: bool = False) -> dict[str, Any]:
    key = _api_key()
    url = f"{IDENTITY_API}{path}?key={key}" if path.startswith(":") else f"{TOKEN_API}?key={key}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12, connect=5)) as client:
            if form:
                result = await client.post(url, data=payload)
            else:
                result = await client.post(url, json=payload)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="AUTH_PROVIDER_UNAVAILABLE") from exc
    try:
        data = result.json()
    except ValueError:
        data = {}
    if not result.is_success:
        code = data.get("error", {}).get("message", "AUTH_PROVIDER_ERROR") if isinstance(data, dict) else "AUTH_PROVIDER_ERROR"
        raise HTTPException(status_code=401 if code in {"INVALID_PASSWORD", "EMAIL_NOT_FOUND", "INVALID_LOGIN_CREDENTIALS", "USER_DISABLED"} else 400, detail=str(code))
    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="AUTH_PROVIDER_INVALID_RESPONSE")
    return data


def _user(data: dict[str, Any], display_name: str = "") -> dict[str, str]:
    uid = data.get("localId") or data.get("user_id")
    email = data.get("email")
    if not isinstance(uid, str) or not isinstance(email, str):
        raise HTTPException(status_code=502, detail="AUTH_PROVIDER_INVALID_RESPONSE")
    return {"uid": uid, "email": email, "displayName": display_name or str(data.get("displayName") or "")}


def _store_session(user: dict[str, str], firebase: dict[str, Any]) -> str:
    refresh_token = firebase.get("refreshToken")
    id_token = firebase.get("idToken")
    if not isinstance(refresh_token, str) or not isinstance(id_token, str):
        raise HTTPException(status_code=502, detail="AUTH_PROVIDER_INVALID_RESPONSE")
    crypto = _fernet()
    session_token = secrets.token_urlsafe(48)
    expires_in = int(firebase.get("expiresIn", "3600"))
    values = (
        _token_hash(session_token), user["uid"], user["email"], user["displayName"],
        crypto.encrypt(refresh_token.encode()).decode(), crypto.encrypt(id_token.encode()).decode(),
        time.time() + max(expires_in, 60), time.time(),
    )
    with _database() as connection:
        connection.execute(
            "INSERT INTO auth_sessions (token_hash,uid,email,display_name,refresh_token,id_token,token_expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)",
            values,
        )
    return session_token


def _set_session_response(response: Response, request: Request, token: str, user: dict[str, str]) -> dict[str, Any]:
    result: dict[str, Any] = {"user": user}
    if request.headers.get("x-elevate-client") == "web":
        same_site = bff_settings.bff_cookie_samesite.lower()
        secure = bff_settings.app_env.lower() == "production" or same_site == "none"
        response.set_cookie(
            COOKIE_NAME, token, httponly=True, secure=secure, samesite=same_site,
            max_age=SESSION_MAX_AGE, path="/api",
        )
    else:
        result["session_token"] = token
    return result


async def _create_firebase_session(request: Request, response: Response, firebase: dict[str, Any], display_name: str = "") -> dict[str, Any]:
    user = _user(firebase, display_name)
    # Identity Toolkit sign-in does not consistently include the profile name.
    if not user["displayName"] and firebase.get("idToken"):
        try:
            profile = await _firebase_request(":lookup", {"idToken": firebase["idToken"]})
            users = profile.get("users")
            if isinstance(users, list) and users and isinstance(users[0], dict):
                user["displayName"] = str(users[0].get("displayName") or "")
        except HTTPException:
            pass
    token = _store_session(user, firebase)
    return _set_session_response(response, request, token, user)


@router.post("/register")
async def register(payload: RegistrationRequest, request: Request, response: Response) -> dict[str, Any]:
    _check_browser_origin(request)
    created = await _firebase_request(":signUp", {"email": payload.email, "password": payload.password, "returnSecureToken": True})
    named = await _firebase_request(":update", {
        "idToken": created.get("idToken", ""), "displayName": payload.display_name, "returnSecureToken": True,
    })
    return await _create_firebase_session(request, response, named, payload.display_name)


@router.post("/login")
async def login(payload: CredentialsRequest, request: Request, response: Response) -> dict[str, Any]:
    _check_browser_origin(request)
    firebase = await _firebase_request(":signInWithPassword", {
        "email": payload.email, "password": payload.password, "returnSecureToken": True,
    })
    return await _create_firebase_session(request, response, firebase)


@router.post("/password-reset")
async def password_reset(payload: PasswordResetRequest, request: Request) -> dict[str, bool]:
    _check_browser_origin(request)
    await _firebase_request(":sendOobCode", {"requestType": "PASSWORD_RESET", "email": payload.email})
    return {"sent": True}


@router.get("/session")
async def get_session(request: Request) -> dict[str, Any]:
    token = _session_credential(request)
    if not token:
        raise HTTPException(status_code=401, detail="AUTH_SESSION_REQUIRED")
    with _database() as connection:
        row = connection.execute("SELECT * FROM auth_sessions WHERE token_hash = ?", (_token_hash(token),)).fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="AUTH_SESSION_EXPIRED")
    if row["created_at"] + SESSION_MAX_AGE <= time.time():
        with _database() as connection:
            connection.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (_token_hash(token),))
        raise HTTPException(status_code=401, detail="AUTH_SESSION_EXPIRED")
    user = {"uid": row["uid"], "email": row["email"], "displayName": row["display_name"]}
    if row["token_expires_at"] > time.time() + 60:
        return {"user": user}
    try:
        crypto = _fernet()
        refresh_token = crypto.decrypt(row["refresh_token"].encode()).decode()
        refreshed = await _firebase_request("/token", {"grant_type": "refresh_token", "refresh_token": refresh_token}, form=True)
        next_refresh = refreshed.get("refresh_token", refresh_token)
        next_id_token = refreshed.get("id_token")
        if not isinstance(next_id_token, str):
            raise HTTPException(status_code=401, detail="AUTH_SESSION_EXPIRED")
        with _database() as connection:
            connection.execute(
                "UPDATE auth_sessions SET refresh_token=?,id_token=?,token_expires_at=? WHERE token_hash=?",
                (crypto.encrypt(next_refresh.encode()).decode(), crypto.encrypt(next_id_token.encode()).decode(),
                 time.time() + int(refreshed.get("expires_in", "3600")), _token_hash(token)),
            )
        return {"user": user}
    except HTTPException as exc:
        if exc.status_code in {400, 401}:
            with _database() as connection:
                connection.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (_token_hash(token),))
            raise HTTPException(status_code=401, detail="AUTH_SESSION_EXPIRED") from exc
        raise
    except (InvalidToken, ValueError, TypeError) as exc:
        with _database() as connection:
            connection.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (_token_hash(token),))
        raise HTTPException(status_code=401, detail="AUTH_SESSION_EXPIRED") from exc


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict[str, bool]:
    _check_browser_origin(request)
    token = _session_credential(request)
    if token:
        with _database() as connection:
            connection.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (_token_hash(token),))
    same_site = bff_settings.bff_cookie_samesite.lower()
    response.delete_cookie(COOKIE_NAME, path="/api", httponly=True, secure=bff_settings.app_env.lower() == "production" or same_site == "none", samesite=same_site)
    return {"logged_out": True}
