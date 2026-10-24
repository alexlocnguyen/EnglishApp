"""PostgreSQL-backed curriculum, learner data, notifications, and admin API."""

from __future__ import annotations

import base64
import binascii
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

try:
    from .auth_bff import current_user
except ImportError:
    from auth_bff import current_user

router = APIRouter(prefix="/api/learning", tags=["learning"])


class LearningSettings(BaseSettings):
    database_url: str = ""
    initial_admin_emails: str = ""
    audio_storage_dir: str = ""
    model_config = SettingsConfigDict(env_file=Path(__file__).with_name(".env"), extra="ignore")


learning_settings = LearningSettings()


def connect() -> psycopg.Connection:
    dsn = learning_settings.database_url.strip()
    if not dsn:
        raise HTTPException(status_code=503, detail="DATABASE_NOT_CONFIGURED")
    try:
        return psycopg.connect(dsn, connect_timeout=5)
    except psycopg.Error as exc:
        raise HTTPException(status_code=503, detail="DATABASE_UNAVAILABLE") from exc


def ensure_user(connection: psycopg.Connection, user: dict[str, str]) -> int:
    connection.execute(
        "INSERT INTO app_users(firebase_uid,email,display_name) VALUES (%s,%s,%s) "
        "ON CONFLICT(firebase_uid) DO UPDATE SET email=EXCLUDED.email, display_name=EXCLUDED.display_name",
        (user["uid"], user["email"], user.get("displayName", "")),
    )
    row = connection.execute("SELECT user_id FROM app_users WHERE firebase_uid=%s", (user["uid"],)).fetchone()
    if not row:
        raise HTTPException(status_code=500, detail="USER_SYNC_FAILED")
    user_id = row[0]
    connection.execute("INSERT INTO user_roles(user_id,role_id) SELECT %s,role_id FROM roles WHERE role_name='learner' ON CONFLICT DO NOTHING", (user_id,))
    admins = {email.strip().lower() for email in learning_settings.initial_admin_emails.split(",") if email.strip()}
    if user["email"].lower() in admins:
        connection.execute("INSERT INTO user_roles(user_id,role_id) SELECT %s,role_id FROM roles WHERE role_name='admin' ON CONFLICT DO NOTHING", (user_id,))
    return user_id


def db_user(user: dict[str, str] = Depends(current_user)):
    connection = connect()
    try:
        user_id = ensure_user(connection, user)
        connection.commit()
        yield connection, user_id, user
    finally:
        connection.close()


def admin_user(context=Depends(db_user)):
    connection, user_id, user = context
    role = connection.execute("SELECT 1 FROM user_roles ur JOIN roles r USING(role_id) WHERE ur.user_id=%s AND r.role_name='admin'", (user_id,)).fetchone()
    if not role:
        raise HTTPException(status_code=403, detail="ADMIN_ROLE_REQUIRED")
    return context


def refresh_user_progress(connection: psycopg.Connection, user_id: int) -> None:
    totals = connection.execute("SELECT coalesce(sum(duration_seconds),0),max(created_at::date) FROM practice_sessions WHERE user_id=%s", (user_id,)).fetchone()
    days = {row[0] for row in connection.execute("SELECT DISTINCT created_at::date FROM practice_sessions WHERE user_id=%s ORDER BY created_at::date DESC LIMIT 400", (user_id,)).fetchall()}
    day = datetime.now(timezone.utc).date()
    if day not in days:
        day = day.fromordinal(day.toordinal() - 1)
    streak = 0
    while day in days:
        streak += 1
        day = day.fromordinal(day.toordinal() - 1)
    completed = connection.execute("SELECT count(*) FROM lesson_progress WHERE user_id=%s AND status='completed'", (user_id,)).fetchone()[0]
    connection.execute("""INSERT INTO user_progress(user_id,last_active_date,total_practice_minutes,streak_days,completed_lesson_count,updated_at)
        VALUES (%s,%s,%s,%s,%s,now()) ON CONFLICT(user_id) DO UPDATE SET
        last_active_date=EXCLUDED.last_active_date,total_practice_minutes=EXCLUDED.total_practice_minutes,
        streak_days=EXCLUDED.streak_days,completed_lesson_count=EXCLUDED.completed_lesson_count,updated_at=now()""",
        (user_id,totals[1],totals[0]//60,streak,completed))


class SessionPayload(BaseModel):
    client_session_id: str = Field(min_length=1, max_length=100)
    topic: str = Field(min_length=1, max_length=300)
    lesson_id: int | None = None
    created_at: datetime | None = None
    duration_seconds: int = Field(default=0, ge=0, le=86400)
    transcript: str = ""
    turns: list[dict[str, Any]] = Field(default_factory=list)
    summary: str | None = None
    feedback: list[dict[str, Any]] = Field(default_factory=list)


class VocabularySave(BaseModel):
    word: str = Field(min_length=1, max_length=200)
    definition: str = Field(default="", max_length=2000)
    example: str = Field(default="", max_length=2000)
    lesson_id: int | None = None
    source: str = Field(default="learner", max_length=40)


class ReminderSettings(BaseModel):
    enabled: bool
    local_time: str = Field(default="19:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    weekdays: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4, 5, 6])


class PronunciationResult(BaseModel):
    pronunciation_score: float | None = Field(default=None, ge=0, le=100)
    fluency_score: float | None = Field(default=None, ge=0, le=100)
    accuracy_score: float | None = Field(default=None, ge=0, le=100)
    detailed_feedback: str = Field(default="", max_length=5000)


class TopicPayload(BaseModel):
    topic_name: str = Field(min_length=1, max_length=200)
    description: str = ""
    level: str = "A2"


class LessonPayload(BaseModel):
    topic_id: int
    lesson_title: str = Field(min_length=1, max_length=200)
    content: str = ""
    objectives: str = ""
    sort_order: int = 0


class VocabularyPayload(BaseModel):
    lesson_id: int
    word: str = Field(min_length=1, max_length=200)
    definition: str = ""
    example: str = ""
    audio_pronunciation_url: str | None = None


@router.get("/catalog")
def catalog():
    with connect() as connection:
        topics = connection.execute("SELECT topic_id,topic_name,level,description FROM topics ORDER BY topic_id").fetchall()
        lessons = connection.execute("SELECT lesson_id,topic_id,lesson_title,content,objectives,sort_order FROM lessons ORDER BY topic_id,sort_order,lesson_id").fetchall()
        words = connection.execute("SELECT vocabulary_id,lesson_id,word,definition,example,audio_pronunciation_url FROM vocabulary ORDER BY vocabulary_id").fetchall()
    return {
        "topics": [dict(zip(("topic_id", "topic_name", "level", "description"), row)) for row in topics],
        "lessons": [dict(zip(("lesson_id", "topic_id", "lesson_title", "content", "objectives", "sort_order"), row)) for row in lessons],
        "vocabulary": [dict(zip(("vocabulary_id", "lesson_id", "word", "definition", "example", "audio_pronunciation_url"), row)) for row in words],
    }


@router.get("/progress")
def progress(context=Depends(db_user)):
    connection, user_id, _ = context
    row = connection.execute("""SELECT count(*),coalesce(sum(duration_seconds),0),max(created_at),
        count(*) FILTER (WHERE created_at >= now() - interval '7 days')
        FROM practice_sessions WHERE user_id=%s""", (user_id,)).fetchone()
    lesson_count = connection.execute("SELECT count(*) FROM lessons").fetchone()[0]
    completed = connection.execute("SELECT count(*) FROM lesson_progress WHERE user_id=%s AND status='completed'", (user_id,)).fetchone()[0]
    active_days = connection.execute("SELECT DISTINCT created_at::date FROM practice_sessions WHERE user_id=%s ORDER BY created_at::date DESC LIMIT 400", (user_id,)).fetchall()
    dates = {item[0] for item in active_days}
    day = datetime.now(timezone.utc).date()
    if day not in dates:
        day = day.fromordinal(day.toordinal() - 1)
    streak = 0
    while day in dates:
        streak += 1
        day = day.fromordinal(day.toordinal() - 1)
    return {"session_count": row[0], "total_practice_minutes": row[1] // 60, "last_active_at": row[2], "sessions_last_7_days": row[3], "completed_lesson_count": completed, "total_lesson_count": lesson_count, "streak_days": streak}


@router.get("/me")
def me(context=Depends(db_user)):
    connection,user_id,user=context
    roles=connection.execute("SELECT r.role_name FROM user_roles ur JOIN roles r USING(role_id) WHERE ur.user_id=%s ORDER BY r.role_name",(user_id,)).fetchall()
    return {"user_id":user_id,"firebase_uid":user["uid"],"email":user["email"],"display_name":user.get("displayName",""),"roles":[r[0] for r in roles]}


@router.get("/lesson-progress")
def lesson_progress(context=Depends(db_user)):
    connection,user_id,_=context
    rows=connection.execute("SELECT lesson_id,status,completed_at FROM lesson_progress WHERE user_id=%s",(user_id,)).fetchall()
    return [{"lesson_id":r[0],"status":r[1],"completed_at":r[2]} for r in rows]


@router.post("/lessons/{lesson_id}/complete")
def complete_lesson(lesson_id: int, context=Depends(db_user)):
    connection, user_id, _ = context
    found = connection.execute("SELECT 1 FROM lessons WHERE lesson_id=%s", (lesson_id,)).fetchone()
    if not found:
        raise HTTPException(status_code=404, detail="LESSON_NOT_FOUND")
    prior = connection.execute("SELECT status FROM lesson_progress WHERE user_id=%s AND lesson_id=%s", (user_id, lesson_id)).fetchone()
    connection.execute("""INSERT INTO lesson_progress(user_id,lesson_id,status,completed_at)
        VALUES (%s,%s,'completed',now()) ON CONFLICT(user_id,lesson_id) DO UPDATE
        SET status='completed',completed_at=now()""", (user_id, lesson_id))
    title = connection.execute("SELECT lesson_title FROM lessons WHERE lesson_id=%s", (lesson_id,)).fetchone()[0]
    if not prior or prior[0] != "completed":
        connection.execute("INSERT INTO notifications(user_id,title,message) VALUES (%s,%s,%s)", (user_id, "Bài học đã hoàn thành", f"Bạn vừa hoàn thành bài học: {title}"))
    connection.execute("INSERT INTO system_logs(user_id,action,log_details) VALUES (%s,'lesson.completed',%s::jsonb)", (user_id, json.dumps({"lesson_id": lesson_id})))
    refresh_user_progress(connection,user_id)
    connection.commit()
    return {"lesson_id": lesson_id, "status": "completed"}


@router.get("/vocabulary")
def user_vocabulary(context=Depends(db_user)):
    connection, user_id, _ = context
    rows = connection.execute("""SELECT uv.user_vocabulary_id,uv.vocabulary_id,v.word,v.definition,v.example,
        uv.status,uv.last_reviewed_at,uv.created_at FROM user_vocabulary uv
        JOIN vocabulary v USING(vocabulary_id) WHERE uv.user_id=%s ORDER BY uv.created_at DESC""", (user_id,)).fetchall()
    keys = ("user_vocabulary_id", "vocabulary_id", "word", "definition", "example", "status", "last_reviewed_at", "created_at")
    return [dict(zip(keys, row)) for row in rows]


@router.post("/vocabulary")
def save_vocabulary(payload: VocabularySave, context=Depends(db_user)):
    connection, user_id, _ = context
    vocabulary_id = None
    if payload.lesson_id:
        row = connection.execute("SELECT vocabulary_id FROM vocabulary WHERE lesson_id IS NOT DISTINCT FROM %s AND lower(word)=lower(%s)", (payload.lesson_id, payload.word)).fetchone()
        vocabulary_id = row[0] if row else None
    if not vocabulary_id:
        row = connection.execute("INSERT INTO vocabulary(lesson_id,word,definition,example) VALUES (%s,%s,%s,%s) RETURNING vocabulary_id", (payload.lesson_id, payload.word, payload.definition, payload.example)).fetchone()
        vocabulary_id = row[0]
    row = connection.execute("""INSERT INTO user_vocabulary(user_id,vocabulary_id,status)
        VALUES (%s,%s,'learning') ON CONFLICT(user_id,vocabulary_id) DO UPDATE SET status='learning'
        RETURNING user_vocabulary_id""", (user_id, vocabulary_id)).fetchone()
    connection.execute("INSERT INTO system_logs(user_id,action,log_details) VALUES (%s,'vocabulary.saved',%s::jsonb)", (user_id, json.dumps({"vocabulary_id": vocabulary_id})))
    connection.commit()
    return {"user_vocabulary_id": row[0], "vocabulary_id": vocabulary_id}


@router.post("/vocabulary/{user_vocabulary_id}/reviewed")
def mark_vocabulary_reviewed(user_vocabulary_id: int, context=Depends(db_user)):
    connection, user_id, _ = context
    cursor = connection.execute("UPDATE user_vocabulary SET status='known',last_reviewed_at=now() WHERE user_vocabulary_id=%s AND user_id=%s", (user_vocabulary_id, user_id))
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="VOCABULARY_NOT_FOUND")
    connection.commit()
    return {"status": "known"}


@router.post("/sessions")
def save_session(payload: SessionPayload, context=Depends(db_user)):
    connection, user_id, _ = context
    created_at = payload.created_at or datetime.now(timezone.utc)
    existing = connection.execute("SELECT session_id FROM practice_sessions WHERE user_id=%s AND client_session_id=%s", (user_id,payload.client_session_id)).fetchone()
    replace_messages = existing is None or any(isinstance(turn.get("audioBase64"), str) and turn.get("audioBase64") for turn in payload.turns)
    row = connection.execute("""INSERT INTO practice_sessions(user_id,lesson_id,client_session_id,topic_label,
        duration_seconds,summary,created_at,transcript) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT(user_id,client_session_id) DO UPDATE SET lesson_id=EXCLUDED.lesson_id,
        topic_label=EXCLUDED.topic_label,duration_seconds=EXCLUDED.duration_seconds,
        summary=EXCLUDED.summary,transcript=EXCLUDED.transcript RETURNING session_id""",
        (user_id,payload.lesson_id,payload.client_session_id,payload.topic,payload.duration_seconds,payload.summary,created_at,payload.transcript)).fetchone()
    session_id = row[0]
    if payload.lesson_id is not None:
        connection.execute("INSERT INTO lesson_progress(user_id,lesson_id,status) VALUES (%s,%s,'started') ON CONFLICT(user_id,lesson_id) DO NOTHING",(user_id,payload.lesson_id))
    if replace_messages:
        connection.execute("DELETE FROM practice_messages WHERE session_id=%s", (session_id,))
        sequence = 0
        for turn in payload.turns:
            sequence += 1
            msg = connection.execute("""INSERT INTO practice_messages(session_id,sequence_number,sender_type,content,
                translation,feedback,pronunciation_feedback,has_audio,created_at) VALUES (%s,%s,'user',%s,%s,%s,%s,%s,%s) RETURNING message_id""",
                (session_id,sequence,str(turn.get("transcript", "")),turn.get("translation"),turn.get("feedback"),turn.get("pronunciationFeedback"),bool(turn.get("hasAudio") or turn.get("audioBase64")),created_at)).fetchone()[0]
            audio_b64 = turn.get("audioBase64")
            if isinstance(audio_b64, str) and audio_b64:
                encoded = audio_b64.split(",", 1)[1] if audio_b64.startswith("data:") and "," in audio_b64 else audio_b64
                try:
                    audio_bytes = base64.b64decode(encoded, validate=True)
                except (ValueError, binascii.Error) as exc:
                    raise HTTPException(status_code=422, detail="INVALID_AUDIO_ENCODING") from exc
                if not audio_bytes or len(audio_bytes) > 15 * 1024 * 1024:
                    raise HTTPException(status_code=413, detail="AUDIO_TOO_LARGE")
                root = Path(learning_settings.audio_storage_dir or Path(__file__).parent / "data" / "audio")
                root.mkdir(parents=True, exist_ok=True)
                path = root / f"{uuid.uuid4().hex}.wav"
                path.write_bytes(audio_bytes)
                recording_id = connection.execute("""INSERT INTO audio_recordings(session_id,user_id,message_id,file_path,duration_seconds,created_at)
                    VALUES (%s,%s,%s,%s,0,%s) RETURNING recording_id""",(session_id,user_id,msg,str(path),created_at)).fetchone()[0]
                pronunciation = str(turn.get("pronunciationFeedback", "")).strip()
                if pronunciation:
                    connection.execute("INSERT INTO pronunciation_feedbacks(recording_id,detailed_feedback) VALUES (%s,%s) ON CONFLICT(recording_id) DO UPDATE SET detailed_feedback=EXCLUDED.detailed_feedback",(recording_id,pronunciation))
            for position, suggestion in enumerate(turn.get("suggestions", []), 1):
                connection.execute("INSERT INTO message_suggestions(message_id,position,suggestion_text) VALUES (%s,%s,%s)", (msg,position,str(suggestion)))
            if turn.get("reply"):
                sequence += 1
                connection.execute("INSERT INTO practice_messages(session_id,sequence_number,sender_type,content,created_at) VALUES (%s,%s,'assistant',%s,%s)", (session_id,sequence,str(turn["reply"]),created_at))
    connection.execute("DELETE FROM session_feedback WHERE session_id=%s", (session_id,))
    for position, item in enumerate(payload.feedback, 1):
        connection.execute("INSERT INTO session_feedback(session_id,position,title,score,detail) VALUES (%s,%s,%s,%s,%s)", (session_id,position,str(item.get("title", "Feedback")),item.get("score"),str(item.get("detail", ""))))
        title = str(item.get("title", "Feedback"))
        prompt = f"Bạn cần cải thiện điều gì về {title} trong chủ đề {payload.topic}?"
        connection.execute("""INSERT INTO review_cards(session_id,kind,title,prompt,answer)
            SELECT %s,'feedback',%s,%s,%s WHERE NOT EXISTS
            (SELECT 1 FROM review_cards WHERE session_id=%s AND kind='feedback' AND title=%s)""",
            (session_id,title,prompt,str(item.get("detail", "")),session_id,title))
    for turn in payload.turns:
        for suggestion in turn.get("suggestions", []):
            title = str(suggestion).strip()
            if title:
                connection.execute("""INSERT INTO review_cards(session_id,kind,title,prompt,answer)
                    SELECT %s,'phrase',%s,'Hãy thử nói câu này trong một tình huống tương tự:',%s WHERE NOT EXISTS
                    (SELECT 1 FROM review_cards WHERE session_id=%s AND kind='phrase' AND title=%s)""",
                    (session_id,title,title,session_id,title))
    connection.execute("INSERT INTO system_logs(user_id,action,log_details) VALUES (%s,'practice.session.synced',%s::jsonb)", (user_id, json.dumps({"client_session_id": payload.client_session_id, "turn_count": len(payload.turns)})))
    refresh_user_progress(connection,user_id)
    connection.commit()
    return {"session_id": session_id, "client_session_id": payload.client_session_id}


@router.get("/sessions")
def sessions(context=Depends(db_user)):
    connection, user_id, _ = context
    rows = connection.execute("""SELECT session_id,client_session_id,topic_label,created_at,duration_seconds,
        transcript,summary FROM practice_sessions WHERE user_id=%s ORDER BY created_at DESC LIMIT 500""", (user_id,)).fetchall()
    result = []
    for row in rows:
        session_id = row[0]
        messages = connection.execute("""SELECT message_id,sender_type,content,translation,feedback,
            pronunciation_feedback,has_audio FROM practice_messages WHERE session_id=%s ORDER BY sequence_number""", (session_id,)).fetchall()
        turns = []
        current = None
        for message in messages:
            if message[1] == "user":
                suggestions = connection.execute("SELECT suggestion_text FROM message_suggestions WHERE message_id=%s ORDER BY position", (message[0],)).fetchall()
                current = {"transcript":message[2],"translation":message[3],"feedback":message[4],"pronunciationFeedback":message[5],"hasAudio":message[6],"suggestions":[s[0] for s in suggestions]}
                turns.append(current)
            elif current is not None:
                current["reply"] = message[2]
                current = None
        feedback = connection.execute("SELECT title,detail,score FROM session_feedback WHERE session_id=%s ORDER BY position", (session_id,)).fetchall()
        result.append({"id":row[1],"topic":row[2],"createdAt":row[3].isoformat(),"durationSeconds":row[4],"transcript":row[5],"summary":row[6],"turns":turns,"feedback":[{"title":x[0],"detail":x[1],"score":x[2]} for x in feedback]})
    return result


@router.get("/review-cards")
def review_cards(context=Depends(db_user)):
    connection,user_id,_=context
    rows=connection.execute("""SELECT rc.review_card_id,ps.client_session_id,ps.topic_label,rc.title,rc.prompt,
        rc.answer,rc.kind,rc.is_reviewed FROM review_cards rc JOIN practice_sessions ps USING(session_id)
        WHERE ps.user_id=%s ORDER BY rc.created_at DESC""",(user_id,)).fetchall()
    keys=("id","sessionId","topic","title","prompt","answer","kind","reviewed")
    return [dict(zip(keys,(str(r[0]),r[1],r[2],r[3],r[4],r[5],r[6],r[7]))) for r in rows]


@router.post("/review-cards/{review_card_id}/reviewed")
def review_card_done(review_card_id:int,context=Depends(db_user)):
    connection,user_id,_=context
    cursor=connection.execute("""UPDATE review_cards rc SET is_reviewed=true,reviewed_at=now()
        FROM practice_sessions ps WHERE rc.session_id=ps.session_id AND ps.user_id=%s AND rc.review_card_id=%s""",(user_id,review_card_id))
    if not cursor.rowcount: raise HTTPException(status_code=404,detail="REVIEW_CARD_NOT_FOUND")
    connection.commit()
    return {"reviewed":True}


@router.get("/reminders")
def get_reminder_settings(context=Depends(db_user)):
    connection, user_id, _ = context
    row = connection.execute("SELECT enabled,local_time,weekdays FROM notification_preferences WHERE user_id=%s", (user_id,)).fetchone()
    return {"enabled":row[0],"local_time":row[1],"weekdays":row[2]} if row else {"enabled":False,"local_time":"19:00","weekdays":[0,1,2,3,4,5,6]}


@router.put("/reminders")
def put_reminder_settings(payload: ReminderSettings, context=Depends(db_user)):
    if any(day < 0 or day > 6 for day in payload.weekdays):
        raise HTTPException(status_code=422, detail="WEEKDAYS_MUST_BE_0_TO_6")
    connection, user_id, _ = context
    connection.execute("""INSERT INTO notification_preferences(user_id,enabled,local_time,weekdays)
        VALUES (%s,%s,%s::time,%s::smallint[]) ON CONFLICT(user_id) DO UPDATE SET enabled=EXCLUDED.enabled,
        local_time=EXCLUDED.local_time,weekdays=EXCLUDED.weekdays,updated_at=now()""", (user_id,payload.enabled,payload.local_time,payload.weekdays))
    connection.commit()
    return payload.model_dump()


@router.get("/notifications")
def notifications(context=Depends(db_user)):
    connection, user_id, _ = context
    rows=connection.execute("SELECT notification_id,title,message,is_read,created_at FROM notifications WHERE user_id=%s ORDER BY created_at DESC LIMIT 100",(user_id,)).fetchall()
    return [{"notification_id":r[0],"title":r[1],"message":r[2],"is_read":r[3],"created_at":r[4]} for r in rows]


@router.post("/notifications/{notification_id}/read")
def mark_notification_read(notification_id: int, context=Depends(db_user)):
    connection,user_id,_=context
    cursor=connection.execute("UPDATE notifications SET is_read=true WHERE notification_id=%s AND user_id=%s",(notification_id,user_id))
    if not cursor.rowcount: raise HTTPException(status_code=404,detail="NOTIFICATION_NOT_FOUND")
    connection.commit()
    return {"is_read":True}


@router.post("/sessions/{client_session_id}/recordings")
async def save_recording(client_session_id: str, file: UploadFile, context=Depends(db_user)):
    connection,user_id,_=context
    session=connection.execute("SELECT session_id FROM practice_sessions WHERE user_id=%s AND client_session_id=%s",(user_id,client_session_id)).fetchone()
    if not session: raise HTTPException(status_code=404,detail="SESSION_NOT_FOUND")
    content=await file.read(15*1024*1024+1)
    if len(content)>15*1024*1024: raise HTTPException(status_code=413,detail="AUDIO_TOO_LARGE")
    if not (file.content_type or "").startswith("audio/"): raise HTTPException(status_code=415,detail="AUDIO_REQUIRED")
    root=Path(learning_settings.audio_storage_dir or Path(__file__).parent/"data"/"audio")
    root.mkdir(parents=True,exist_ok=True)
    safe_name=f"{uuid.uuid4().hex}{Path(file.filename or 'audio').suffix[:10]}"
    path=root/safe_name
    path.write_bytes(content)
    duration=max(0,int((connection.execute("SELECT duration_seconds FROM practice_sessions WHERE session_id=%s",(session[0],)).fetchone() or [0])[0]))
    connection.execute("INSERT INTO audio_recordings(session_id,user_id,file_path,duration_seconds,created_at) VALUES (%s,%s,%s,%s,now())",(session[0],user_id,str(path),duration))
    connection.commit()
    return {"stored":True}


@router.post("/sessions/{client_session_id}/pronunciation-feedback")
def save_pronunciation_feedback(client_session_id: str, payload: PronunciationResult, context=Depends(db_user)):
    connection,user_id,_=context
    row=connection.execute("""SELECT ar.recording_id FROM audio_recordings ar JOIN practice_sessions ps USING(session_id)
        WHERE ps.user_id=%s AND ps.client_session_id=%s ORDER BY ar.created_at DESC LIMIT 1""",(user_id,client_session_id)).fetchone()
    if not row: raise HTTPException(status_code=404,detail="RECORDING_NOT_FOUND")
    connection.execute("""INSERT INTO pronunciation_feedbacks(recording_id,pronunciation_score,fluency_score,accuracy_score,detailed_feedback)
        VALUES (%s,%s,%s,%s,%s) ON CONFLICT(recording_id) DO UPDATE SET
        pronunciation_score=EXCLUDED.pronunciation_score,fluency_score=EXCLUDED.fluency_score,
        accuracy_score=EXCLUDED.accuracy_score,detailed_feedback=EXCLUDED.detailed_feedback,created_at=now()""",
        (row[0],payload.pronunciation_score,payload.fluency_score,payload.accuracy_score,payload.detailed_feedback))
    connection.execute("INSERT INTO system_logs(user_id,action,log_details) VALUES (%s,'pronunciation.feedback.saved',%s::jsonb)",(user_id,json.dumps({"recording_id":row[0]})))
    connection.commit()
    return {"saved":True}


@router.post("/admin/topics", dependencies=[Depends(admin_user)])
def create_topic(payload: TopicPayload):
    with connect() as connection:
        row=connection.execute("INSERT INTO topics(topic_name,level,description) VALUES (%s,%s,%s) RETURNING topic_id",(payload.topic_name,payload.level,payload.description)).fetchone()
    return {"topic_id":row[0]}


@router.post("/admin/lessons", dependencies=[Depends(admin_user)])
def create_lesson(payload: LessonPayload):
    with connect() as connection:
        row=connection.execute("INSERT INTO lessons(topic_id,lesson_title,content,objectives,sort_order) VALUES (%s,%s,%s,%s,%s) RETURNING lesson_id",(payload.topic_id,payload.lesson_title,payload.content,payload.objectives,payload.sort_order)).fetchone()
    return {"lesson_id":row[0]}


@router.post("/admin/vocabulary", dependencies=[Depends(admin_user)])
def create_catalog_vocabulary(payload: VocabularyPayload):
    with connect() as connection:
        row=connection.execute("INSERT INTO vocabulary(lesson_id,word,definition,example,audio_pronunciation_url) VALUES (%s,%s,%s,%s,%s) RETURNING vocabulary_id",(payload.lesson_id,payload.word,payload.definition,payload.example,payload.audio_pronunciation_url)).fetchone()
    return {"vocabulary_id":row[0]}


@router.get("/admin/users", dependencies=[Depends(admin_user)])
def list_users():
    with connect() as connection:
        rows=connection.execute("""SELECT u.user_id,u.email,u.display_name,array_agg(r.role_name ORDER BY r.role_name)
            FROM app_users u LEFT JOIN user_roles ur USING(user_id) LEFT JOIN roles r USING(role_id)
            GROUP BY u.user_id ORDER BY u.created_at DESC LIMIT 500""").fetchall()
    return [{"user_id":r[0],"email":r[1],"display_name":r[2],"roles":r[3]} for r in rows]


@router.put("/admin/users/{target_user_id}/role/{role_name}", dependencies=[Depends(admin_user)])
def set_user_role(target_user_id: int, role_name: str):
    if role_name not in {"learner","admin"}: raise HTTPException(status_code=400,detail="ROLE_NOT_ALLOWED")
    with connect() as connection:
        exists=connection.execute("SELECT 1 FROM app_users WHERE user_id=%s",(target_user_id,)).fetchone()
        if not exists: raise HTTPException(status_code=404,detail="USER_NOT_FOUND")
        role=connection.execute("SELECT role_id FROM roles WHERE role_name=%s",(role_name,)).fetchone()
        if not role: raise HTTPException(status_code=404,detail="ROLE_NOT_FOUND")
        connection.execute("INSERT INTO user_roles(user_id,role_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",(target_user_id,role[0]))
        if role_name=="learner":
            admin_role=connection.execute("SELECT role_id FROM roles WHERE role_name='admin'").fetchone()
            if admin_role: connection.execute("DELETE FROM user_roles WHERE user_id=%s AND role_id=%s",(target_user_id,admin_role[0]))
        connection.execute("INSERT INTO system_logs(action,log_details) VALUES ('user.role.changed',%s::jsonb)",(json.dumps({"user_id":target_user_id,"role":role_name}),))
    return {"user_id":target_user_id,"role":role_name}
