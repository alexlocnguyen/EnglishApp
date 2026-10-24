from __future__ import annotations

import base64
import binascii
import asyncio
import io
import json
import logging
import re
import time
import uuid
from functools import lru_cache
from typing import Any, Literal

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from starlette.concurrency import run_in_threadpool


class Settings(BaseSettings):
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash-lite"
    kokoro_lang_code: str = "a"
    kokoro_voice: str = "af_heart"
    kokoro_speed: float = Field(default=1.0, ge=0.5, le=2.0)
    cors_origins: str = "http://localhost:8081,http://127.0.0.1:8081"
    max_audio_mb: int = Field(default=14, ge=1, le=15)
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
kokoro_lock = asyncio.Lock()
logger = logging.getLogger("elevate-backend")


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        event: dict[str, Any] = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in ("request_id", "method", "path", "status_code", "duration_ms", "provider", "error_type"):
            value = getattr(record, key, None)
            if value is not None:
                event[key] = value
        if record.exc_info:
            event["exception_type"] = record.exc_info[0].__name__ if record.exc_info[0] else "Exception"
        return json.dumps(event, ensure_ascii=False, separators=(",", ":"))


_log_handler = logging.StreamHandler()
_log_handler.setFormatter(JsonLogFormatter())
logger.handlers.clear()
logger.addHandler(_log_handler)
logger.setLevel(logging.INFO)
logger.propagate = False
app = FastAPI(title="Elevate English AI API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials="*" not in settings.origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_request_metrics(request: Request, call_next):
    request_id = uuid.uuid4().hex
    started_at = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as exc:
        logger.error(
            "http_request_failed",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": 500,
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 2),
                "error_type": type(exc).__name__,
            },
        )
        raise
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "http_request_completed",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "duration_ms": round((time.perf_counter() - started_at) * 1000, 2),
        },
    )
    return response

API_ROOT = "https://generativelanguage.googleapis.com/v1beta"


@lru_cache(maxsize=1)
def get_kokoro_pipeline():
    from kokoro import KPipeline

    return KPipeline(lang_code=settings.kokoro_lang_code)


def generate_kokoro_wav(text: str) -> bytes:
    import numpy as np
    import soundfile as sf

    pipeline = get_kokoro_pipeline()
    audio_parts = [
        np.asarray(audio, dtype=np.float32)
        for _, _, audio in pipeline(
            text,
            voice=settings.kokoro_voice,
            speed=settings.kokoro_speed,
            split_pattern=r"\n+",
        )
    ]
    if not audio_parts:
        raise RuntimeError("Kokoro không tạo được audio từ câu đã nhận.")
    audio = audio_parts[0] if len(audio_parts) == 1 else np.concatenate(audio_parts)
    output = io.BytesIO()
    sf.write(output, audio, 24000, format="WAV")
    return output.getvalue()


class VoiceTurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    audio_base64: str = Field(min_length=16, max_length=21_000_000)
    mime_type: str = Field(default="audio/wav", max_length=100)
    topic: str = Field(default="Free conversation", max_length=300)

    @field_validator("mime_type")
    @classmethod
    def validate_audio_mime(cls, value: str) -> str:
        mime = value.split(";", 1)[0].strip().lower()
        if not mime.startswith("audio/"):
            raise ValueError("mime_type must be an audio media type")
        return mime


class TextRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    text: str = Field(min_length=1, max_length=3000)


class ChatTurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    message: str = Field(min_length=1, max_length=3000)
    topic: str = Field(default="Free conversation", max_length=300)


class FeedbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    topic: str = Field(default="English speaking", max_length=300)
    transcript: str = Field(min_length=1, max_length=12000)


class VocabularyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    topic: str = Field(default="English speaking", max_length=300)
    transcript: str = Field(min_length=1, max_length=12000)


class FeedbackItem(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: Literal["Ngữ pháp", "Điểm có thể khắc phục"]
    score: str = Field(min_length=1, max_length=40)
    detail: str = Field(min_length=1, max_length=2000)


class SpeakingFeedbackResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    summary: str = Field(min_length=1, max_length=1000)
    feedback: list[FeedbackItem] = Field(min_length=2, max_length=2)

    @model_validator(mode="after")
    def require_expected_feedback_categories(self):
        titles = {item.title for item in self.feedback}
        if titles != {"Ngữ pháp", "Điểm có thể khắc phục"}:
            raise ValueError("feedback must include grammar and improvement items")
        return self


def require_api_key() -> str:
    if not settings.gemini_api_key.strip():
        raise HTTPException(
            status_code=503,
            detail="Backend chưa có GEMINI_API_KEY. Hãy cấu hình backend/.env.",
        )
    return settings.gemini_api_key.strip()


def _json_text(response: dict[str, Any]) -> str:
    try:
        return response["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError, TypeError) as exc:
        prompt_feedback = response.get("promptFeedback")
        if prompt_feedback:
            raise HTTPException(status_code=422, detail="AI không thể xử lý nội dung audio này.") from exc
        raise HTTPException(status_code=502, detail="AI trả về nội dung rỗng hoặc không đúng định dạng.") from exc


def _parse_json(text: str) -> dict[str, Any]:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.IGNORECASE)
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        logger.warning("gemini_invalid_json", extra={"provider": "gemini", "error_type": type(exc).__name__})
        raise HTTPException(status_code=502, detail="AI trả về dữ liệu không đúng định dạng.") from exc
    if not isinstance(value, dict):
        raise HTTPException(status_code=502, detail="AI trả về dữ liệu không đúng định dạng.")
    return value


async def gemini_generate(
    parts: list[dict[str, Any]],
    *,
    json_response: bool = True,
    response_schema: dict[str, Any] | None = None,
    max_output_tokens: int = 900,
) -> dict[str, Any]:
    api_key = require_api_key()
    config: dict[str, Any] = {"temperature": 0.4, "maxOutputTokens": max_output_tokens}
    if json_response:
        config["responseMimeType"] = "application/json"
        if response_schema is not None:
            config["responseJsonSchema"] = response_schema
    url = f"{API_ROOT}/models/{settings.gemini_model}:generateContent"
    body = {"contents": [{"role": "user", "parts": parts}], "generationConfig": config}
    started_at = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(55, connect=10)) as client:
            response = await client.post(url, headers={"x-goog-api-key": api_key}, json=body)
    except httpx.TimeoutException as exc:
        logger.warning(
            "ai_provider_timeout",
            extra={"provider": "gemini", "duration_ms": round((time.perf_counter() - started_at) * 1000, 2)},
        )
        raise HTTPException(status_code=504, detail="AI phản hồi quá lâu. Bạn hãy thử lại.") from exc
    except httpx.HTTPError as exc:
        logger.warning(
            "ai_provider_request_failed",
            extra={
                "provider": "gemini",
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 2),
                "error_type": type(exc).__name__,
            },
        )
        raise HTTPException(status_code=502, detail="Không thể kết nối Gemini API.") from exc
    logger.info(
        "ai_provider_response",
        extra={
            "provider": "gemini",
            "status_code": response.status_code,
            "duration_ms": round((time.perf_counter() - started_at) * 1000, 2),
        },
    )
    if response.status_code >= 400:
        logger.warning(
            "gemini_api_error",
            extra={"provider": "gemini", "status_code": response.status_code},
        )
        if response.status_code == 429:
            raise HTTPException(status_code=429, detail="Đã chạm hạn mức miễn phí AI. Hãy thử lại sau.")
        if response.status_code in (401, 403):
            raise HTTPException(status_code=503, detail="Gemini API key không hợp lệ hoặc chưa có quyền dùng model.")
        raise HTTPException(status_code=502, detail="Gemini API không xử lý được yêu cầu này.")
    return response.json()


def decode_audio(audio_base64: str) -> bytes:
    # Accept either raw base64 or a data URL from a browser recorder.
    encoded = audio_base64.split(",", 1)[1] if audio_base64.startswith("data:") and "," in audio_base64 else audio_base64
    try:
        audio = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Audio gửi lên không phải base64 hợp lệ.") from exc
    if not audio:
        raise HTTPException(status_code=400, detail="Audio trống.")
    if len(audio) > settings.max_audio_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Audio vượt quá {settings.max_audio_mb} MB.")
    return audio


def audio_mime(audio: bytes, filename: str = "") -> str:
    lower = filename.lower()
    if audio.startswith(b"RIFF") and audio[8:12] == b"WAVE":
        return "audio/wav"
    if audio.startswith(b"OggS") or lower.endswith(".ogg"):
        return "audio/ogg"
    if audio.startswith(b"ID3") or lower.endswith(".mp3"):
        return "audio/mpeg"
    if lower.endswith((".m4a", ".mp4")) or audio[4:8] == b"ftyp":
        return "audio/mp4"
    return "audio/webm" if lower.endswith(".webm") else "audio/wav"


def audio_part(audio: bytes, mime: str) -> dict[str, Any]:
    return {"inlineData": {"mimeType": mime, "data": base64.b64encode(audio).decode("ascii")}}


def _string(value: Any, fallback: str = "") -> str:
    return value.strip() if isinstance(value, str) else fallback


def _list_of_strings(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()][:4]


@app.get("/")
async def root() -> dict[str, str]:
    return {"name": "Elevate English AI API", "docs": "/docs", "health": "/api/health"}


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "provider": "Google Gemini API",
        "configured": bool(settings.gemini_api_key.strip()),
        "model": settings.gemini_model,
        "tts_provider": "Kokoro",
        "tts_voice": settings.kokoro_voice,
    }


@app.post("/api/voice-turn")
async def voice_turn(request: VoiceTurnRequest) -> dict[str, Any]:
    audio = decode_audio(request.audio_base64)
    prompt = f"""You are a friendly, patient English speaking partner for a Vietnamese learner.
Topic: {request.topic}
Listen to the attached audio. Transcribe the learner's English exactly as best possible. Then:
- translate their meaning into natural Vietnamese;
- reply in simple, natural English to continue the conversation, usually one or two sentences and one question;
- give two short English reply ideas the learner could say next;
- give brief, kind Vietnamese feedback on one useful grammar, vocabulary, or clarity improvement. Do not invent pronunciation analysis that the audio does not support.
- assess how clear and understandable the learner's spoken English sounds from this audio only; return a concise Vietnamese pronunciation_feedback, or an empty string if there is no clearly audible English. Do not score individual Vietnamese words or claim phoneme-level accuracy.
If the audio is unclear or contains no speech, say so in transcript and keep the other fields helpful and honest.
Return ONLY JSON with keys transcript, translation, reply, suggestions (array of strings), feedback, pronunciation_feedback."""
    voice_schema = {
        "type": "object",
        "properties": {
            "transcript": {"type": "string"},
            "translation": {"type": "string"},
            "reply": {"type": "string"},
            "suggestions": {"type": "array", "maxItems": 2, "items": {"type": "string"}},
            "feedback": {"type": "string"},
            "pronunciation_feedback": {"type": "string"},
        },
        "required": ["transcript", "translation", "reply", "suggestions", "feedback", "pronunciation_feedback"],
    }
    mime_type = request.mime_type.split(";", 1)[0].strip()
    if not mime_type.startswith("audio/"):
        mime_type = "audio/wav"
    response = await gemini_generate(
        [{"text": prompt}, audio_part(audio, mime_type)],
        response_schema=voice_schema,
        max_output_tokens=1200,
    )
    result = _parse_json(_json_text(response))
    return {
        "transcript": _string(result.get("transcript")),
        "translation": _string(result.get("translation")),
        "reply": _string(result.get("reply")),
        "suggestions": _list_of_strings(result.get("suggestions")),
        "feedback": _string(result.get("feedback")),
        "pronunciation_feedback": _string(result.get("pronunciation_feedback")),
    }


@app.post("/api/chat-turn")
async def chat_turn(request: ChatTurnRequest) -> dict[str, Any]:
    prompt = f"""You are a friendly, patient English conversation partner for a Vietnamese learner.
Topic: {request.topic}
Learner message (may be Vietnamese or English): {request.message}
Understand their intent. Set transcript to a natural English version of what they meant (if already English, transcribe/correct it naturally). Set translation to a concise Vietnamese meaning. Reply in simple natural English to continue the conversation, usually one or two sentences and one question. Give two short English ideas for what the learner could say next. Give brief, kind Vietnamese feedback if there is a useful English improvement; don't criticize their use of Vietnamese.
Return ONLY JSON with keys transcript, translation, reply, suggestions (array of strings), feedback."""
    response = await gemini_generate([{"text": prompt}])
    result = _parse_json(_json_text(response))
    return {
        "transcript": _string(result.get("transcript")),
        "translation": _string(result.get("translation")),
        "reply": _string(result.get("reply")),
        "suggestions": _list_of_strings(result.get("suggestions")),
        "feedback": _string(result.get("feedback")),
    }


@app.post("/api/ai/speaking-feedback")
async def speaking_feedback(request: FeedbackRequest) -> dict[str, Any]:
    prompt = f"""Evaluate this English practice transcript for a Vietnamese learner.
Topic: {request.topic}
Transcript: {request.transcript}
Give concise, encouraging, actionable Vietnamese feedback. Assess overall grammar in one item, and specific fixable issues (word choice, sentence structure, or fluency) in one other item. Base everything only on the transcript; never assess pronunciation from text. Include one corrected natural version in the relevant detail when useful. Return one short overall summary and exactly two feedback items titled "Ngữ pháp" and "Điểm có thể khắc phục", each with a short score/rating and actionable detail in Vietnamese."""
    schema = {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "feedback": {
                "type": "array",
                "minItems": 2,
                "maxItems": 2,
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "enum": ["Ngữ pháp", "Điểm có thể khắc phục"]},
                        "score": {"type": "string"},
                        "detail": {"type": "string"},
                    },
                    "required": ["title", "score", "detail"],
                },
            },
        },
        "required": ["summary", "feedback"],
    }
    response = await gemini_generate([{"text": prompt}], response_schema=schema, max_output_tokens=900)
    result = _parse_json(_json_text(response))
    feedback = result.get("feedback")
    if not isinstance(feedback, list):
        feedback = []
    try:
        validated = SpeakingFeedbackResponse.model_validate({"summary": result.get("summary"), "feedback": feedback})
    except ValidationError as exc:
        logger.warning("gemini_feedback_schema_error", extra={"provider": "gemini", "error_type": type(exc).__name__})
        raise HTTPException(status_code=502, detail="AI trả về phần nhận xét chưa đủ hoặc sai cấu trúc.") from exc
    return validated.model_dump()


async def _minhqnd_lookup(term: str) -> dict[str, Any] | None:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8, connect=4)) as client:
            response = await client.get(
                "https://dict.minhqnd.com/api/v1/lookup",
                params={"word": term.strip(), "lang": "en", "def_lang": "vi"},
            )
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            logger.warning("minhqnd dictionary API returned HTTP %s", response.status_code)
            raise HTTPException(status_code=502, detail="Từ điển minhqnd đang gặp lỗi khi tra cứu.")
        payload = response.json()
        if not isinstance(payload, dict) or payload.get("exists") is not True:
            return None
        returned_word = " ".join(_string(payload.get("word")).lower().split())
        requested_word = " ".join(term.strip().lower().split())
        if returned_word and returned_word != requested_word:
            return None
        return payload
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning(
            "dictionary_lookup_failed",
            extra={"provider": "minhqnd", "error_type": type(exc).__name__},
        )
        raise HTTPException(status_code=502, detail="Không thể kết nối từ điển minhqnd lúc này.")


def _minhqnd_vietnamese_definition(entry: dict[str, Any]) -> tuple[str, str] | None:
    results = entry.get("results")
    if not isinstance(results, list):
        return None
    definitions: list[str] = []
    example = ""
    for result in results:
        if not isinstance(result, dict) or _string(result.get("lang_code")).lower() != "en":
            continue
        meanings = result.get("meanings")
        if isinstance(meanings, list):
            for meaning in meanings:
                if not isinstance(meaning, dict) or _string(meaning.get("definition_lang")).lower() != "vi":
                    continue
                definition = _string(meaning.get("definition"))
                if definition and definition not in definitions:
                    definitions.append(definition)
                    example = example or _string(meaning.get("example"))
        translations = result.get("translations")
        if isinstance(translations, list):
            for translation in translations:
                if not isinstance(translation, dict) or _string(translation.get("lang_code")).lower() != "vi":
                    continue
                translated = _string(translation.get("translation"))
                if translated and translated not in definitions:
                    definitions.append(translated)
    if not definitions:
        return None
    return "; ".join(definitions[:4]), example


@app.post("/api/ai/topic-vocabulary")
async def topic_vocabulary(request: VocabularyRequest) -> dict[str, Any]:
    prompt = f"""Choose useful vocabulary for a Vietnamese learner based on this English practice.
Topic: {request.topic}
Learner transcript: {request.transcript}
Infer an approximate CEFR level (A1, A2, B1, B2, or C1) from the transcript. Return up to three single-word English verbs as base forms and up to three established English phrasal verbs/phrases, prioritizing common, topic-relevant items the learner did not already use. Choose simpler items for beginner-level language. Do not provide definitions, translations, or examples. The backend will verify every candidate with the minhqnd English-Vietnamese dictionary and discard entries without Vietnamese definitions.
Return only the requested structured data."""
    schema = {
        "type": "object",
        "properties": {
            "level": {"type": "string", "enum": ["A1", "A2", "B1", "B2", "C1"]},
            "verbs": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
            "phrases": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
        },
        "required": ["level", "verbs", "phrases"],
    }
    generated = await gemini_generate([{"text": prompt}], response_schema=schema, max_output_tokens=700)
    try:
        candidates = _parse_json(_json_text(generated))
    except HTTPException:
        raise

    validated_verbs: list[dict[str, str]] = []
    for candidate in candidates.get("verbs", []) if isinstance(candidates.get("verbs"), list) else []:
        if len(validated_verbs) >= 3 or not isinstance(candidate, str):
            continue
        word = candidate.strip().lower()
        if not re.fullmatch(r"[a-z][a-z'-]{1,30}", word):
            continue
        entry = await _minhqnd_lookup(word)
        sense = _minhqnd_vietnamese_definition(entry) if entry else None
        if not sense:
            continue
        validated_verbs.append({
            "word": word,
            "definition": sense[0],
            "example": sense[1],
            "sourceUrl": "https://dict.minhqnd.com/",
        })

    verified_phrase: dict[str, str] | None = None
    for candidate in candidates.get("phrases", []) if isinstance(candidates.get("phrases"), list) else []:
        if not isinstance(candidate, str):
            continue
        phrase = " ".join(candidate.strip().lower().split())
        if len(phrase.split()) < 2 or len(phrase) > 80:
            continue
        entry = await _minhqnd_lookup(phrase)
        sense = _minhqnd_vietnamese_definition(entry) if entry else None
        if sense:
            verified_phrase = {
                "phrase": phrase,
                "definition": sense[0],
                "example": sense[1],
                "sourceUrl": "https://dict.minhqnd.com/",
            }
            break

    if len(validated_verbs) < 2 or not verified_phrase:
        raise HTTPException(
            status_code=502,
            detail="Từ điển chưa xác minh đủ từ/cụm cho chủ đề này. Hãy thử tải lại để lấy gợi ý khác.",
        )
    return {"level": _string(candidates.get("level"), "A2"), "verbs": validated_verbs, "phrase": verified_phrase}


@app.post("/api/translate")
async def translate(request: TextRequest) -> dict[str, str]:
    prompt = "Translate the following English text to natural Vietnamese. Return only the translation, preserving meaning and tone: " + request.text
    response = await gemini_generate([{"text": prompt}], json_response=False)
    return {"translation": _json_text(response)}


@app.post("/api/analyze")
async def analyze_audio(
    file: UploadFile = File(...),
    target_sentence: str = Form(default="", max_length=1000),
) -> dict[str, Any]:
    audio = await file.read(settings.max_audio_mb * 1024 * 1024 + 1)
    if not audio:
        raise HTTPException(status_code=400, detail="Tệp audio trống.")
    if len(audio) > settings.max_audio_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Audio vượt quá {settings.max_audio_mb} MB.")
    target = target_sentence.strip()[:1000]
    prompt = f"""Listen to the English learner recording for the practice topic: {target or '(free conversation)'}.
Transcribe only English speech that is actually audible. Give an overall, approximate assessment of how clear and understandable the learner's English pronunciation sounds. This is not certified phoneme scoring. Do not label Vietnamese words as English pronunciation errors. If the clip has no clearly audible English, say that in Vietnamese and return a score of 0. Keep feedback concise. Return an empty words_analysis array; do not evaluate individual words."""
    mime_type = file.content_type or ""
    if not mime_type.startswith("audio/"):
        mime_type = audio_mime(audio, file.filename or "")
    response_schema = {
        "type": "object",
        "properties": {
            "transcribed_text": {"type": "string"},
            "score": {"type": "integer", "minimum": 0, "maximum": 100},
            "feedback": {"type": "string"},
            "words_analysis": {
                "type": "array",
                "maxItems": 40,
                "items": {
                    "type": "object",
                    "properties": {
                        "word": {"type": "string"},
                        "status": {
                            "type": "string",
                            "enum": ["correct", "mispronounced", "missing", "extra", "unclear"],
                        },
                        "suggestion": {"type": "string"},
                    },
                    "required": ["word", "status", "suggestion"],
                },
            },
        },
        "required": ["transcribed_text", "score", "feedback", "words_analysis"],
    }
    response = await gemini_generate(
        [{"text": prompt}, audio_part(audio, mime_type)],
        response_schema=response_schema,
        max_output_tokens=3072,
    )
    result = _parse_json(_json_text(response))
    try:
        score = max(0, min(100, int(result.get("score", 0))))
    except (TypeError, ValueError):
        score = 0
    words = result.get("words_analysis")
    if not isinstance(words, list):
        words = []
    return {
        "filename": file.filename or "recording",
        "target_sentence": target,
        "transcribed_text": _string(result.get("transcribed_text")),
        "score": score,
        "feedback": _string(result.get("feedback")),
        "words_analysis": [word for word in words[:40] if isinstance(word, dict)],
    }


@app.get("/api/speech")
async def speech(text: str = Query(min_length=1, max_length=500)) -> Response:
    try:
        async with kokoro_lock:
            audio_bytes = await run_in_threadpool(generate_kokoro_wav, text)
    except Exception as exc:
        logger.exception("Kokoro TTS generation failed")
        raise HTTPException(
            status_code=503,
            detail="Kokoro chưa sẵn sàng. Hãy cài requirements, cài espeak-ng và kiểm tra log backend.",
        ) from exc
    return Response(content=audio_bytes, media_type="audio/wav", headers={"Cache-Control": "no-store"})
