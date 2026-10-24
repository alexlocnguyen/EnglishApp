# ERD đầy đủ cho ElevateEnglish

Sơ đồ dưới đây theo schema PostgreSQL đang triển khai trong `backend/sql/postgres_schema.sql`. Firebase tiếp tục quản lý xác thực; PostgreSQL lưu danh tính ứng dụng, nội dung học và dữ liệu tiến độ.

```mermaid
erDiagram
    APP_USERS ||--o{ USER_ROLES : has
    ROLES ||--o{ USER_ROLES : grants
    TOPICS ||--o{ LESSONS : contains
    LESSONS ||--o{ VOCABULARY : provides
    APP_USERS ||--o{ USER_VOCABULARY : saves
    VOCABULARY ||--o{ USER_VOCABULARY : selected
    APP_USERS ||--o{ LESSON_PROGRESS : tracks
    LESSONS ||--o{ LESSON_PROGRESS : tracked
    APP_USERS ||--|| USER_PROGRESS : summarizes
    APP_USERS ||--o{ PRACTICE_SESSIONS : starts
    LESSONS o|--o{ PRACTICE_SESSIONS : practices
    PRACTICE_SESSIONS ||--o{ PRACTICE_MESSAGES : contains
    PRACTICE_MESSAGES ||--o{ MESSAGE_SUGGESTIONS : suggests
    PRACTICE_SESSIONS ||--o{ SESSION_FEEDBACK : receives
    PRACTICE_SESSIONS ||--o{ REVIEW_CARDS : creates
    PRACTICE_SESSIONS ||--o{ AUDIO_RECORDINGS : stores
    PRACTICE_MESSAGES o|--o{ AUDIO_RECORDINGS : records
    AUDIO_RECORDINGS ||--o| PRONUNCIATION_FEEDBACKS : receives
    APP_USERS ||--o{ NOTIFICATIONS : receives
    APP_USERS ||--o| NOTIFICATION_PREFERENCES : configures
    APP_USERS o|--o{ SYSTEM_LOGS : performs

    APP_USERS {
        bigint user_id PK
        text firebase_uid UK
        text email UK
        text display_name
        text status
        timestamptz created_at
    }
    ROLES {
        bigint role_id PK
        text role_name UK
        text description
    }
    USER_ROLES {
        bigint user_id PK, FK
        bigint role_id PK, FK
    }
    TOPICS {
        bigint topic_id PK
        text topic_name UK
        text level
        text description
        timestamptz created_at
    }
    LESSONS {
        bigint lesson_id PK
        bigint topic_id FK
        text lesson_title
        text content
        text objectives
        integer sort_order
        timestamptz created_at
    }
    VOCABULARY {
        bigint vocabulary_id PK
        bigint lesson_id FK
        text word
        text definition
        text example
        text audio_pronunciation_url
    }
    USER_VOCABULARY {
        bigint user_vocabulary_id PK
        bigint user_id FK
        bigint vocabulary_id FK
        text status
        timestamptz last_reviewed_at
    }
    LESSON_PROGRESS {
        bigint user_id PK, FK
        bigint lesson_id PK, FK
        text status
        timestamptz started_at
        timestamptz completed_at
    }
    USER_PROGRESS {
        bigint progress_id PK
        bigint user_id FK, UK
        date last_active_date
        integer total_practice_minutes
        integer streak_days
        integer completed_lesson_count
    }
    PRACTICE_SESSIONS {
        bigint session_id PK
        bigint user_id FK
        bigint lesson_id FK
        text client_session_id
        text topic_label
        integer duration_seconds
        text transcript
        text summary
        timestamptz created_at
    }
    PRACTICE_MESSAGES {
        bigint message_id PK
        bigint session_id FK
        integer sequence_number
        text sender_type
        text content
        text translation
        text feedback
        text pronunciation_feedback
        boolean has_audio
    }
    MESSAGE_SUGGESTIONS {
        bigint suggestion_id PK
        bigint message_id FK
        integer position
        text suggestion_text
    }
    AUDIO_RECORDINGS {
        bigint recording_id PK
        bigint session_id FK
        bigint user_id FK
        bigint message_id FK
        text file_path
        integer duration_seconds
        timestamptz created_at
    }
    PRONUNCIATION_FEEDBACKS {
        bigint feedback_id PK
        bigint recording_id FK, UK
        numeric pronunciation_score
        numeric fluency_score
        numeric accuracy_score
        text detailed_feedback
    }
    SESSION_FEEDBACK {
        bigint feedback_id PK
        bigint session_id FK
        integer position
        text title
        text score
        text detail
    }
    REVIEW_CARDS {
        bigint review_card_id PK
        bigint session_id FK
        text kind
        text title
        text prompt
        text answer
        boolean is_reviewed
        timestamptz reviewed_at
    }
    NOTIFICATION_PREFERENCES {
        bigint user_id PK, FK
        boolean enabled
        time local_time
        smallint weekdays
        timestamptz updated_at
    }
    NOTIFICATIONS {
        bigint notification_id PK
        bigint user_id FK
        text title
        text message
        boolean is_read
        timestamptz created_at
    }
    SYSTEM_LOGS {
        bigint log_id PK
        bigint user_id FK
        text action
        jsonb log_details
        timestamptz created_at
    }
```

## Luồng tính năng

- Quản trị viên tạo chủ đề, bài học và từ vựng qua màn hình Quản trị. Người học luyện theo bài, đánh dấu hoàn thành và xem tiến độ tích lũy.
- Mỗi phiên có các lượt người học/trợ lý, gợi ý trả lời, phản hồi cuối buổi và thẻ ôn tập.
- Audio được lưu vào thư mục cấu hình `AUDIO_STORAGE_DIR`; database chỉ giữ đường dẫn và metadata. Khi triển khai, thư mục cần nằm trên volume bền vững hoặc được thay bằng object storage.
- Từ/cụm từ người học lưu được gắn vào `USER_VOCABULARY`. Tiến độ học bài nằm trong `LESSON_PROGRESS`; `USER_PROGRESS` giữ phần tổng hợp.
- Công tắc nhắc học đặt thông báo cục bộ trên thiết bị và đồng bộ lịch với `NOTIFICATION_PREFERENCES`. Bảng `NOTIFICATIONS` ghi các sự kiện như hoàn thành bài học; remote push chưa được cấu hình.
- Các bảng học tập yêu cầu đăng nhập. Firebase UID ánh xạ sang `APP_USERS`; không lưu mật khẩu Firebase trong PostgreSQL.

Áp dụng schema và seed dữ liệu mẫu theo hướng dẫn trong [`backend/README.md`](../backend/README.md).
