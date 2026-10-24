# ElevateEnglish

Ứng dụng luyện giao tiếp tiếng Anh, xây dựng bằng Expo, React Native và Expo Router. Người học có thể chọn chủ đề, luyện nói hoặc nhập câu trả lời, xem bản dịch và nhận xét, rồi xem lại các buổi đã lưu và thẻ ôn tập.

## Yêu cầu

- Node.js **22.13 trở lên trong nhánh 22.x** (mức tối thiểu của Expo SDK 57).
- npm đi kèm Node.js. Repo có `package-lock.json`, vì vậy dùng npm để cài dependency.
- Android Emulator hoặc điện thoại Android/iOS để chạy app; hoặc trình duyệt để chạy bản web.
- Backend AI là tuỳ chọn khi mới mở app. Cần backend để dùng hội thoại AI, dịch và một số tính năng nhận xét/giọng đọc.

## Cài đặt và chạy app

Mở terminal tại thư mục gốc của repo:

```bash
npm ci
npm start
```

`npm ci` cài đúng các phiên bản được khoá trong `package-lock.json`. Chạy `npm start` để khởi động Expo Dev Server; terminal sẽ hiện QR code và các phím tắt. Giữ terminal này mở trong lúc phát triển.

Có thể chọn đích chạy ngay bằng các lệnh sau:

```bash
npm run android
npm run ios
npm run web
```

- `npm run android`: khởi động Expo và mở app trên Android Emulator đang chạy hoặc thiết bị đã kết nối.
- `npm run ios`: mở trên iOS Simulator (cần môi trường macOS phù hợp); dùng QR code để mở trên iPhone cũng được.
- `npm run web`: chạy phiên bản web trong trình duyệt.

Khi chỉ chạy `npm start`, nhấn `a` để mở Android, `i` để mở iOS Simulator, hoặc `w` để mở web. Trên điện thoại, cài Expo Go hoặc development build theo cấu hình dự án rồi quét QR. Điện thoại và máy phát triển thường cần cùng mạng Wi-Fi. Nếu kết nối LAN bị chặn, thử `npx expo start --tunnel` (cần cài/bật hỗ trợ tunnel của Expo).

Một số phím tắt hữu ích trong terminal Expo: `r` tải lại app, `m` mở Developer Menu, `j` mở React Native DevTools, `?` liệt kê tất cả phím tắt.

## Các lệnh phát triển

```bash
npm run lint
npx tsc --noEmit
npx expo-doctor
npx expo install --check
```

- `npm run lint`: chạy Expo ESLint trên mã nguồn.
- `npx tsc --noEmit`: kiểm tra kiểu TypeScript mà không tạo file đầu ra.
- `npx expo-doctor`: kiểm tra cấu hình và các vấn đề tương thích phổ biến của dự án Expo.
- `npx expo install --check`: kiểm tra phiên bản các package Expo có phù hợp với SDK trong dự án không.

Khi thêm package thuộc Expo hoặc package native, ưu tiên `npx expo install <tên-package>` để chọn phiên bản tương thích với SDK hiện tại. Sau đó có thể cần tạo/chạy development build thay vì Expo Go.

## Cấu hình backend AI

App chạy được một số luồng cục bộ mà không cần backend. Để bật hội thoại AI, dịch và nhận xét qua AI, hãy chạy backend theo hướng dẫn chi tiết tại [`backend/README.md`](backend/README.md). Tóm tắt:

1. Tạo Gemini API key trong [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Cài Python 3.12 và eSpeak NG trên Windows; hướng dẫn cài Kokoro và các dependency nằm trong README của backend.
3. Tạo `backend/.env` từ `backend/.env.example` rồi đặt `GEMINI_API_KEY` vào file đó.
4. Khởi động FastAPI backend tại cổng `8000`.
5. Tạo file `.env` ở thư mục gốc từ `.env.example`, rồi đặt `EXPO_PUBLIC_API_URL` thành URL backend có thể truy cập từ app.
6. Khởi động lại Expo sau khi thay đổi `.env`.

Ví dụ URL theo thiết bị:

```env
# Android Emulator (máy ảo Android mặc định)
EXPO_PUBLIC_API_URL=http://10.0.2.2:8000

# Web hoặc app chạy trực tiếp trên máy phát triển
# EXPO_PUBLIC_API_URL=http://localhost:8000

# Điện thoại thật: thay bằng địa chỉ IPv4 nội bộ của máy chạy backend
# EXPO_PUBLIC_API_URL=http://192.168.1.10:8000
```

Điện thoại thật không thể dùng `localhost` để truy cập backend trên máy tính: địa chỉ đó trỏ về chính điện thoại. Hãy dùng IP nội bộ của máy chạy backend và đảm bảo hai thiết bị cùng mạng. Mở `http://localhost:8000/docs` trên máy backend để xem tài liệu API; `http://localhost:8000/api/health` trả trạng thái backend.

**Không đưa Gemini API key vào app hoặc biến `EXPO_PUBLIC_*`.** Các biến có tiền tố này được đóng gói cho phía client. Chỉ lưu Gemini key trong `backend/.env` và không commit file `.env`.

### Biến môi trường của app

Các tên biến được khai báo trong [`.env.example`](.env.example):

| Biến | Mục đích |
|---|---|
| `EXPO_PUBLIC_API_URL` | URL gốc của backend, ví dụ `http://192.168.1.10:8000`. |
| `EXPO_PUBLIC_AI_FEEDBACK_PATH` | Đường dẫn API nhận xét bài nói; mặc định `/api/ai/speaking-feedback`. |
| `EXPO_PUBLIC_AI_ANALYZE_PATH` | Đường dẫn API phân tích audio; mặc định `/api/analyze`. |
| `EXPO_PUBLIC_AI_SPEECH_PATH` | Đường dẫn API tạo audio giọng nói; mặc định `/api/speech`. |
| `EXPO_PUBLIC_AI_TRANSLATE_PATH` | Đường dẫn API dịch; mặc định `/api/translate`. |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Firebase Web API key, chỉ cần nếu bật Firebase. |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain, chỉ cần nếu bật Firebase. |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | Firebase project ID, chỉ cần nếu bật Firebase. |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | Firebase Web app ID, chỉ cần nếu bật Firebase. |

Các luồng đăng nhập Firebase là tuỳ chọn. Khi chưa cấu hình Firebase, có thể sử dụng các tính năng luyện tập lưu trên thiết bị.

## Chạy backend nhanh trên Windows PowerShell

Làm đầy đủ các bước trong [`backend/README.md`](backend/README.md), đặc biệt phần cài eSpeak NG và thiết lập `backend/.env`. Các lệnh cơ bản từ thư mục repo:

```powershell
cd backend
py -3.12 -m venv .venv-kokoro
.\.venv-kokoro\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
# Mở backend\.env và điền GEMINI_API_KEY
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Nếu PowerShell chặn kích hoạt virtual environment, xem cách bật script trong tài liệu Python/Windows hoặc chạy `.\.venv-kokoro\Scripts\python.exe -m pip install -r requirements.txt` và `.\.venv-kokoro\Scripts\uvicorn.exe main:app --reload --host 0.0.0.0 --port 8000` mà không activate. Kokoro tải model và voice khi chạy lần đầu nên lần đầu có thể mất thêm thời gian.

## Tính năng

- Chọn chủ đề và luyện hội thoại bằng micro hoặc nhập bằng bàn phím.
- Phát câu mẫu và câu trả lời bằng giọng Kokoro từ backend; một số trường hợp có thể dùng giọng đọc hệ thống trên thiết bị.
- Nhận transcript, bản dịch, gợi ý trả lời và phản hồi từ backend AI.
- Xem nhận xét bài nói và phân tích audio theo câu đích.
- Lưu lịch sử buổi tập và tạo thẻ ôn tập trên thiết bị.
- Dùng Firebase Authentication nếu đã cấu hình thông tin Firebase trong `.env`.

Audio được gửi tới Gemini khi gọi các chức năng AI tương ứng. Backend hiện tại không lưu buổi luyện vào database; lịch sử và thẻ ôn tập do app lưu cục bộ trên thiết bị. Điểm phân tích phát âm là ước lượng từ mô hình, không phải phép đo âm vị chuyên dụng. Xem thêm lưu ý về dữ liệu và triển khai trong [`backend/README.md`](backend/README.md).

## Cấu trúc thư mục

```text
src/app/          Các màn hình và route Expo Router
src/components/   Thành phần giao diện dùng lại
src/services/     Backend AI, Firebase, audio và lịch sử buổi luyện
assets/           Hình ảnh và tài nguyên giao diện
backend/          FastAPI, Gemini và Kokoro
```

## Tham khảo

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
- [Expo CLI](https://docs.expo.dev/more/expo-cli/)
- [Backend README](backend/README.md)
