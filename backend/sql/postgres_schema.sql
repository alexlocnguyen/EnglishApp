-- PostgreSQL schema for the full learning-app ERD. Apply once to a new database.
CREATE TABLE IF NOT EXISTS app_users (
    user_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    firebase_uid text NOT NULL UNIQUE,
    email text NOT NULL UNIQUE,
    display_name text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
    role_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_name text NOT NULL UNIQUE,
    description text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS user_roles (
    user_id bigint NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
    role_id bigint NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    PRIMARY KEY(user_id,role_id)
);

CREATE TABLE IF NOT EXISTS topics (
    topic_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    topic_name text NOT NULL UNIQUE,
    level text NOT NULL DEFAULT 'A2',
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lessons (
    lesson_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    topic_id bigint NOT NULL REFERENCES topics(topic_id) ON DELETE CASCADE,
    lesson_title text NOT NULL,
    content text NOT NULL DEFAULT '',
    objectives text NOT NULL DEFAULT '',
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vocabulary (
    vocabulary_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lesson_id bigint REFERENCES lessons(lesson_id) ON DELETE SET NULL,
    word text NOT NULL,
    definition text NOT NULL DEFAULT '',
    example text NOT NULL DEFAULT '',
    audio_pronunciation_url text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vocabulary_word_idx ON vocabulary(lower(word));
CREATE TABLE IF NOT EXISTS user_vocabulary (
    user_vocabulary_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
    vocabulary_id bigint NOT NULL REFERENCES vocabulary(vocabulary_id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'learning' CHECK (status IN ('learning','known')),
    created_at timestamptz NOT NULL DEFAULT now(),
    last_reviewed_at timestamptz,
    UNIQUE(user_id,vocabulary_id)
);
CREATE TABLE IF NOT EXISTS lesson_progress (
    user_id bigint NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
    lesson_id bigint NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed')),
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    PRIMARY KEY(user_id,lesson_id)
);
CREATE TABLE IF NOT EXISTS user_progress (
    progress_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL UNIQUE REFERENCES app_users(user_id) ON DELETE CASCADE,
    last_active_date date,
    total_practice_minutes integer NOT NULL DEFAULT 0 CHECK (total_practice_minutes >= 0),
    streak_days integer NOT NULL DEFAULT 0 CHECK (streak_days >= 0),
    completed_lesson_count integer NOT NULL DEFAULT 0 CHECK (completed_lesson_count >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS practice_sessions (
    session_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
    lesson_id bigint REFERENCES lessons(lesson_id) ON DELETE SET NULL,
    client_session_id text NOT NULL,
    topic_label text NOT NULL,
    duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
    transcript text NOT NULL DEFAULT '',
    summary text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id,client_session_id)
);
-- Upgrade databases that used the earlier practice-only draft.
ALTER TABLE practice_sessions ADD COLUMN IF NOT EXISTS lesson_id bigint REFERENCES lessons(lesson_id) ON DELETE SET NULL;
ALTER TABLE practice_sessions ADD COLUMN IF NOT EXISTS client_session_id text;
ALTER TABLE practice_sessions ADD COLUMN IF NOT EXISTS transcript text NOT NULL DEFAULT '';
UPDATE practice_sessions SET client_session_id='legacy-session-' || session_id::text WHERE client_session_id IS NULL;
ALTER TABLE practice_sessions ALTER COLUMN client_session_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS practice_sessions_user_client_id_idx ON practice_sessions(user_id,client_session_id);
CREATE INDEX IF NOT EXISTS practice_sessions_user_created_idx ON practice_sessions(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS practice_messages (
    message_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id bigint NOT NULL REFERENCES practice_sessions(session_id) ON DELETE CASCADE,
    sequence_number integer NOT NULL CHECK (sequence_number > 0),
    sender_type text NOT NULL CHECK (sender_type IN ('user','assistant')),
    content text NOT NULL,
    translation text,
    feedback text,
    pronunciation_feedback text,
    has_audio boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(session_id,sequence_number)
);
CREATE TABLE IF NOT EXISTS message_suggestions (
    suggestion_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_id bigint NOT NULL REFERENCES practice_messages(message_id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position > 0),
    suggestion_text text NOT NULL,
    UNIQUE(message_id,position)
);
CREATE TABLE IF NOT EXISTS audio_recordings (
    recording_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id bigint NOT NULL REFERENCES practice_sessions(session_id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
    message_id bigint REFERENCES practice_messages(message_id) ON DELETE CASCADE,
    file_path text NOT NULL,
    duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE audio_recordings ADD COLUMN IF NOT EXISTS message_id bigint REFERENCES practice_messages(message_id) ON DELETE CASCADE;
ALTER TABLE audio_recordings DROP CONSTRAINT IF EXISTS audio_recordings_session_id_key;
CREATE TABLE IF NOT EXISTS pronunciation_feedbacks (
    feedback_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recording_id bigint NOT NULL REFERENCES audio_recordings(recording_id) ON DELETE CASCADE,
    pronunciation_score numeric(5,2) CHECK (pronunciation_score BETWEEN 0 AND 100),
    fluency_score numeric(5,2) CHECK (fluency_score BETWEEN 0 AND 100),
    accuracy_score numeric(5,2) CHECK (accuracy_score BETWEEN 0 AND 100),
    detailed_feedback text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(recording_id)
);
CREATE TABLE IF NOT EXISTS session_feedback (
    feedback_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id bigint NOT NULL REFERENCES practice_sessions(session_id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position > 0),
    title text NOT NULL,
    score text,
    detail text NOT NULL,
    UNIQUE(session_id,position)
);
CREATE TABLE IF NOT EXISTS review_cards (
    review_card_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id bigint NOT NULL REFERENCES practice_sessions(session_id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('feedback','phrase')),
    title text NOT NULL,
    prompt text NOT NULL,
    answer text NOT NULL,
    is_reviewed boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz
);

CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id bigint PRIMARY KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
    enabled boolean NOT NULL DEFAULT false,
    local_time time NOT NULL DEFAULT '19:00',
    weekdays smallint[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6]::smallint[],
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications (
    notification_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
    title text NOT NULL,
    message text NOT NULL,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS system_logs (
    log_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint REFERENCES app_users(user_id) ON DELETE SET NULL,
    action text NOT NULL,
    log_details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO roles(role_name,description) VALUES ('learner','Người học'),('admin','Quản trị nội dung và tài khoản') ON CONFLICT(role_name) DO NOTHING;
INSERT INTO topics(topic_name,level,description) VALUES
('Giới thiệu bản thân','A2','Luyện giới thiệu tên, công việc và sở thích.'),
('Thói quen hằng ngày','A2','Nói về lịch trình và hoạt động thường ngày.'),
('Giao tiếp nơi làm việc','A2','Chào hỏi, nhờ hỗ trợ và cập nhật công việc.'),
('Sắp xếp cuộc họp','B1','Đề xuất thời gian và trao đổi lịch họp.')
ON CONFLICT(topic_name) DO NOTHING;
INSERT INTO lessons(topic_id,lesson_title,content,objectives,sort_order)
SELECT t.topic_id,v.title,v.content,v.objectives,v.sort_order FROM topics t JOIN (VALUES
('Giới thiệu bản thân','Giới thiệu ngắn','Nói tên, vai trò và một sở thích.','Giới thiệu bản thân trong 3 câu.',1),
('Giới thiệu bản thân','Nói về kinh nghiệm','Mô tả công việc và một kỹ năng.','Dùng hiện tại đơn để mô tả công việc.',2),
('Thói quen hằng ngày','Lịch trình buổi sáng','Kể các hoạt động buổi sáng theo thứ tự.','Dùng từ chỉ tần suất và trình tự.',1),
('Giao tiếp nơi làm việc','Nhờ đồng nghiệp giúp đỡ','Đưa ra yêu cầu lịch sự và giải thích ngắn.','Dùng câu hỏi lịch sự để nhờ hỗ trợ.',1),
('Giao tiếp nơi làm việc','Cập nhật tiến độ','Mô tả việc đã hoàn thành và bước tiếp theo.','Trình bày trạng thái công việc rõ ràng.',2),
('Sắp xếp cuộc họp','Chọn thời gian họp','Đề xuất giờ họp và xác nhận lịch.','Đề xuất, đồng ý hoặc đổi lịch.',1)
) AS v(topic_name,title,content,objectives,sort_order) ON t.topic_name=v.topic_name
WHERE NOT EXISTS (SELECT 1 FROM lessons l WHERE l.topic_id=t.topic_id AND l.lesson_title=v.title);

INSERT INTO vocabulary(lesson_id,word,definition,example)
SELECT l.lesson_id,v.word,v.definition,v.example FROM lessons l JOIN topics t USING(topic_id) JOIN (VALUES
('Giới thiệu ngắn','introduce','giới thiệu','Let me introduce myself.'),
('Giới thiệu ngắn','experience','kinh nghiệm','I have experience in customer support.'),
('Lịch trình buổi sáng','usually','thường xuyên','I usually start work at eight.'),
('Nhờ đồng nghiệp giúp đỡ','Could you help me with...?','Bạn có thể giúp tôi việc...?','Could you help me with this report?'),
('Cập nhật tiến độ','on track','đúng tiến độ','The project is on track.'),
('Chọn thời gian họp','Are you available...?','Bạn có rảnh...?','Are you available tomorrow afternoon?')
) AS v(lesson_title,word,definition,example) ON l.lesson_title=v.lesson_title
WHERE NOT EXISTS (SELECT 1 FROM vocabulary x WHERE x.lesson_id=l.lesson_id AND lower(x.word)=lower(v.word));
