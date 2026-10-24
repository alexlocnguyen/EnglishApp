import json

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import main


def valid_feedback() -> dict:
    return {
        "summary": "Bạn diễn đạt được ý chính.",
        "feedback": [
            {"title": "Ngữ pháp", "score": "Tốt", "detail": "Dùng thì quá khứ nhất quán hơn."},
            {"title": "Điểm có thể khắc phục", "score": "Khá", "detail": "Thêm một ví dụ cụ thể."},
        ],
    }


def test_parse_json_accepts_fenced_model_response():
    parsed = main._parse_json('```json\n{"summary":"ok"}\n```')

    assert parsed == {"summary": "ok"}


def test_parse_json_rejects_invalid_json():
    with pytest.raises(HTTPException) as error:
        main._parse_json('{"feedback": }')

    assert error.value.status_code == 502


def test_json_log_formatter_emits_metrics_without_request_content():
    record = main.logger.makeRecord(
        "elevate-backend",
        20,
        "main.py",
        1,
        "http_request_completed",
        (),
        None,
        extra={"request_id": "request-1", "method": "POST", "path": "/api/chat-turn", "status_code": 200, "duration_ms": 12.5},
    )

    event = json.loads(main.JsonLogFormatter().format(record))

    assert event["duration_ms"] == 12.5
    assert event["status_code"] == 200
    assert "message" in event
    assert "transcript" not in event
    assert "api_key" not in event


def test_feedback_response_validates_expected_categories():
    response = main.SpeakingFeedbackResponse.model_validate(valid_feedback())

    assert {item.title for item in response.feedback} == {"Ngữ pháp", "Điểm có thể khắc phục"}


def test_feedback_response_rejects_malformed_model_output():
    with pytest.raises(ValidationError):
        main.SpeakingFeedbackResponse.model_validate({"summary": "Only summary", "feedback": []})


@pytest.mark.parametrize(
    "payload",
    [
        {"topic": "Work", "transcript": "   "},
        {"topic": "Work", "transcript": "valid", "unexpected": "field"},
        {"topic": "Work", "transcript": "x" * 12001},
    ],
)
def test_feedback_request_rejects_invalid_client_input(payload):
    with pytest.raises(ValidationError):
        main.FeedbackRequest.model_validate(payload)


def test_voice_turn_rejects_non_audio_mime():
    with pytest.raises(ValidationError):
        main.VoiceTurnRequest.model_validate({"audio_base64": "AAAAAAAAAAAAAAAA", "mime_type": "text/plain"})


@pytest.mark.parametrize(
    "model,payload",
    [
        (main.TextRequest, {"text": " "}),
        (main.ChatTurnRequest, {"message": "hi", "unexpected": True}),
        (main.VocabularyRequest, {"topic": "Work", "transcript": "x" * 12001}),
    ],
)
def test_request_models_reject_empty_extra_or_oversized_values(model, payload):
    with pytest.raises(ValidationError):
        model.model_validate(payload)
