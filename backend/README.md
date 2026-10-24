# Elevate English AI backend

FastAPI backend dùng Gemini API cho hội thoại từ audio, góp ý bài nói và dịch tiếng Anh sang tiếng Việt. Giọng đọc mẫu câu và câu phản hồi được tạo bằng Kokoro chạy cục bộ trên backend. PostgreSQL lưu chương trình học, tiến độ, từ vựng cá nhân, phiên luyện, phản hồi, thông báo và log; app vẫn giữ bản cục bộ để dùng khi offline.

## 1. Tạo API key miễn phí

Tạo Gemini API key trong [Google AI Studio](https://aistudio.google.com/app/apikey), sau đó chép file `.env.example` thành `.env` trong thư mục `backend` và điền `GEMINI_API_KEY`. Không đặt key trong biến `EXPO_PUBLIC_*`, source mobile hoặc Git. Google cung cấp Free Tier cho một số model; hạn mức tùy model/tài khoản và có thể đổi.

Các file `.env*` đều bị Git ignore, ngoại trừ `.env.example`. Firebase Web API key trong `.env` gốc là cấu hình client và sẽ được đóng gói vào app; không dùng biến `EXPO_PUBLIC_*` cho Gemini key, token dịch vụ, hay mật khẩu. Nếu một secret từng được commit hoặc chia sẻ, hãy thu hồi và tạo secret mới.

Mặc định dùng `gemini-3.5-flash-lite` cho audio/text. Endpoint tạo giọng nói dùng Kokoro, không sử dụng hạn mức TTS của Gemini.

## 2. Cài Kokoro và chạy local trên Windows PowerShell

Kokoro chạy trên backend, không cần API key. Cài **eSpeak NG** trên Windows từ [bản phát hành chính thức](https://github.com/espeak-ng/espeak-ng/releases), thêm vào `PATH`, rồi mở terminal mới. Kokoro sẽ tải model/voice ở lần chạy đầu và lưu trong cache Hugging Face. Repo chính thức hướng dẫn cài `kokoro`/`soundfile` và eSpeak NG trên Windows. Dùng Python 3.12 cho môi trường mới để tránh lỗi build dependency trong virtual environment Python 3.15 đang có.

```powershell
cd G:\Repo\EnglishApp\backend
py -3.12 -m venv .venv-kokoro
.\.venv-kokoro\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
# Sửa backend\.env và thêm GEMINI_API_KEY; Kokoro không cần key
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## PostgreSQL và tính năng học tập

Tạo database PostgreSQL, điền `DATABASE_URL` trong `backend/.env`, rồi chạy schema/seed từ thư mục gốc dự án:

```powershell
$env:DATABASE_URL = "postgresql://postgres:password@localhost:5432/elevate_english"
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f .\backend\sql\postgres_schema.sql
```

Schema có thể chạy trên database mới hoặc nâng cấp bản nháp practice-only trước đó. Nó tạo vai trò `learner`/`admin`, chủ đề và bài học mẫu cùng từ vựng khởi đầu. Mật khẩu vẫn do Firebase quản lý; app_users chỉ lưu Firebase UID, email và tên hiển thị.

```dotenv
DATABASE_URL=postgresql://postgres:password@localhost:5432/elevate_english
INITIAL_ADMIN_EMAILS=your-login-email@example.com
# Đặt đường dẫn này lên volume bền vững khi triển khai; mặc định là backend/data/audio
AUDIO_STORAGE_DIR=
```

Đăng nhập bằng email trong `INITIAL_ADMIN_EMAILS` một lần để nhận quyền quản trị. Màn hình **Quản trị** cho phép thêm chủ đề, bài học, từ vựng và đổi vai trò tài khoản. Màn hình **Chương trình học** cho phép học viên luyện theo bài, đánh dấu hoàn thành và theo dõi tiến độ. Lịch sử/ôn tập/từ vựng cá nhân được đồng bộ khi backend và PostgreSQL sẵn sàng; nếu chưa sẵn sàng app vẫn lưu bản cục bộ.

Nhắc học dùng thông báo cục bộ trên thiết bị, sau khi người dùng cấp quyền. Remote push chưa được cấu hình; bảng `notifications` hiện nhận sự kiện trong app, ví dụ thông báo khi hoàn thành bài học. Bản ghi audio được lưu dưới `AUDIO_STORAGE_DIR`, vì vậy production cần gắn thư mục này vào persistent volume hoặc thay thế bằng object storage.

## Kiểm thử

Trong môi trường Python tương thích với Kokoro, cài `requirements-dev.txt` rồi chạy `python -m pytest`.

Mở `http://localhost:8000/docs` để xem API. Điện thoại và máy tính chạy backend phải cùng Wi-Fi; đặt `EXPO_PUBLIC_API_URL=http://<IP-LAN-của-máy>:8000` trong `.env` của app rồi khởi động Expo lại. `localhost` trên điện thoại trỏ vào chính điện thoại.

## 3. Endpoint

- `GET /api/health`: trạng thái cấu hình (không lộ key).
- `POST /api/voice-turn`: nhận `{ "audio_base64": "...base64...", "mime_type": "audio/wav", "topic": "..." }`; trả transcript, bản dịch, câu trả lời hội thoại, gợi ý và nhận xét.
- `POST /api/chat-turn`: nhận `{ "message": "...", "topic": "..." }` để chat bằng bàn phím hoặc trả lời bằng tiếng Việt.
- `POST /api/ai/speaking-feedback`: nhận chủ đề và transcript; trả nhận xét có cấu trúc.
- `POST /api/translate`: nhận `{ "text": "..." }`; trả `{ "translation": "..." }`.
- `POST /api/analyze`: multipart `file` và `target_sentence`; trả transcript, điểm độ dễ hiểu/độ khớp tương đối và phân tích từng từ.
- `GET /api/speech?text=...`: trả WAV giọng tiếng Anh do Kokoro tạo; giọng mặc định `af_heart`, đổi qua `KOKORO_VOICE`.

Điểm trong `/api/analyze` là ước lượng của mô hình từ audio và câu đích, không thay thế chấm âm vị chuyên dụng. Endpoint audio chặn file lớn hơn `MAX_AUDIO_MB` (mặc định 14 MB). Khi triển khai công khai, hãy giới hạn CORS, bật HTTPS, thêm xác thực và rate limiting theo người dùng; free quota không đảm bảo độ trễ hoặc tính sẵn sàng.

## Lưu ý về dữ liệu

Audio dùng để tạo phản hồi được gửi tới Gemini. Audio bản luyện được giữ riêng trong `AUDIO_STORAGE_DIR` và metadata được ghi vào PostgreSQL. Hãy cấu hình lưu trữ bền vững, chính sách xóa/giữ dữ liệu và quyền truy cập phù hợp trước khi triển khai cho người dùng thật.
