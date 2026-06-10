---
title: NestJs-API
emoji: 🚀
colorFrom: pink
colorTo: red
sdk: docker
pinned: false
---

# Learn NestJS - Authentication & Realtime Chat API (MongoDB + Redis)

API xây dựng bằng **NestJS**, dùng **MongoDB** để lưu dữ liệu nghiệp vụ và **Redis** cho OTP/cooldown, quản lý trạng thái online, cũng như đếm tin nhắn chưa đọc. Hệ thống hiện tại không chỉ xử lý **Authentication** bảo mật mà còn hỗ trợ **Realtime Chat** đầy đủ tính năng thông qua **Socket.IO**.

## Tính năng chính

### 1. Realtime Chat (WebSockets)
- Chat 1-1 (Direct) và Chat nhóm (Group).
- Gửi, nhận tin nhắn realtime qua sự kiện (`chat:new-message`).
- Trạng thái hoạt động (Presence): Hiện trạng online/offline (`user:online`, `user:offline`).
- Typing indicators (Đang gõ...): Quản lý người dùng gõ trên đa thiết bị (`chat:typing-start`, `chat:typing-stop`).
- Tính năng Read Receipts: Cập nhật trạng thái "Đang gửi", "Đã gửi", "Đã xem" và tự động cascade trạng thái `seen` cho các tin nhắn cũ (`chat:mark-read`).
- Quản lý "Unseen messages": Đánh dấu conversation có tin mới thông qua Redis Sets, tối ưu hóa để tránh spam sự kiện (`user:unseen-message`).
- Heartbeat để duy trì phiên kết nối mạng.

### 2. Authentication & Security
- Đăng ký tài khoản, kích hoạt qua email.
- Đăng nhập bằng `passport-local` + JWT.
- Cấp `accessToken` và `refreshToken`.
- Quản lý phiên đăng nhập theo **session**:
  - Mỗi lần login tạo một session mới.
  - `refreshToken` được hash và lưu trong collection `sessions`.
- Hỗ trợ `logout` 1 thiết bị và `logout all devices`.
- `tokenVersion` hỗ trợ thu hồi toàn bộ token cũ sau logout-all.
- Quên mật khẩu / đặt lại mật khẩu bằng OTP.
- **Quản lý Constants**: Hardcoded strings và values được gom nhóm tập trung theo module (`Feature-based Constants`) và biến toàn cục (`Global Constants`) để dễ bảo trì.
- Swagger UI để test API.

## Công nghệ sử dụng

- NestJS 11
- Socket.IO (`@nestjs/websockets`, `@nestjs/platform-socket.io`)
- MongoDB + Mongoose
- Redis + ioredis
- Passport (`local`, `jwt`)
- JWT (`@nestjs/jwt`)
- Resend HTTP API + Handlebars
- Swagger (`@nestjs/swagger`)

## Cài đặt

```bash
git clone https://github.com/quanvu201120/Learn-NestJS.git
cd Learn-NestJS
npm install
```

## Cấu hình môi trường

Tạo `.env` từ file mẫu:

```bash
cp .env.example .env
```

Biến quan trọng:

- App: `PORT`
- MongoDB: `MONGODB_URI`
- Redis: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- JWT: `JWT_SECRET`, `JWT_EXPRIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN_DB`
- Cookie/Bảo mật token: `COOKIE_EXPIRES_IN`, `REFRESH_TOKEN_PEPPER`
- OTP: `CODE_VERIFY_PEPPER`, `MAIL_CODE_ACTIVE_EXPIRE`, `MAIL_CODE_FORGOT_EXPIRE`
- Mail: `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_REGISTER_TEMPLATE`, `MAIL_FORGOT_TEMPLATE`

## Chạy ứng dụng

Development:

```bash
npm run dev
```

Production:

```bash
npm run build
npm run start:prod
```

## Cấu trúc API & Flow chính

### Swagger API Docs

Sau khi chạy app:

- Swagger UI: `http://localhost:8080/swagger`
- Base API: `http://localhost:8080/api/v1`

### Flow test auth cơ bản

1. `POST /auth/login` để lấy `accessToken` và set cookie `refreshToken`.
2. Bấm **Authorize** và nhập `Bearer <accessToken>`.
3. Test `POST /auth/refreshToken`, `POST /auth/logout`, `POST /auth/logoutAll`.

### Session-based auth flow

- **Login**: Tạo session, ký JWT (accessToken & refreshToken), hash refresh token lưu vào DB.
- **Refresh token**: Verify token, kiểm tra session chưa bị revoke. Tạo token mới & rotate session.
- **Logout**: Revoke session hiện tại.
- **Logout all devices**: Tăng `tokenVersion` và revoke toàn bộ session của user.

### Ứng dụng Client (Test Socket)
Bạn có thể mở trực tiếp file `TestSocket/index.html` trong trình duyệt để trải nghiệm Web UI giao tiếp với Socket server. Nó bao gồm màn hình danh sách conversation, lịch sử tin nhắn, và tương tác realtime (online/typing/new messages...).

## Tài liệu tham khảo

- Xem bản đồ luồng logic chi tiết (App Flow) tại file: `docs/app-flow.md`

## Gợi ý deploy free

- MongoDB: MongoDB Atlas (M0)
- Redis: Redis Cloud free
- Backend: Hugging Face Spaces (Docker) hoặc Render free tier

## License

MIT
