---
title: NestJs-API
sdk: docker
---

# HaloChat API — Realtime Chat Platform (NestJS + MongoDB + Redis)

Backend cho nền tảng chat **HaloChat**, xây dựng bằng **NestJS 11**. Hệ thống bao gồm xác thực bảo mật theo session, chat realtime 1-1 và nhóm, gửi media/file/voice, gọi audio/video qua WebRTC, hệ thống bạn bè & chặn người dùng, kiểm duyệt/báo cáo/kháng cáo với nhật ký audit, thống kê quản trị, web push notifications, hàng đợi dọn dẹp tài nguyên (BullMQ) và phục vụ luôn SPA frontend đã build.

- **MongoDB (Mongoose)**: lưu dữ liệu nghiệp vụ.
- **Redis (ioredis)**: OTP/cooldown, trạng thái online, typing, tin chưa đọc, rate limit, cache ICE server WebRTC.
- **Socket.IO**: giao tiếp realtime hai chiều.

## Tính năng chính

### 1. Authentication & Security

- Đăng ký, kích hoạt qua email OTP, đăng nhập bằng `passport-local` (email/số điện thoại) + JWT.
- Đăng nhập bằng **Google OAuth**; tài khoản Google có thể tạo mật khẩu cục bộ sau.
- Quản lý phiên theo **session/thiết bị**: mỗi login tạo session, `refreshToken` được hash (SHA256 + pepper) lưu trong DB; rotate token mỗi lần refresh.
- `logout` một thiết bị và `logoutAll`; `tokenVersion` để thu hồi toàn bộ token cũ (logout-all / disable / ban).
- Danh sách thiết bị đã đăng nhập; thông báo khi đăng nhập từ thiết bị mới.
- Quên/đặt lại mật khẩu, đổi mật khẩu, đổi email — tất cả qua OTP.
- Khóa đăng nhập lũy tiến khi sai mật khẩu nhiều lần (Redis).
- Rate limiting toàn cục (`@nestjs/throttler`) + guard theo `userId:ip`, ghi nhận vi phạm vào hệ thống báo cáo.
- `helmet`, CORS whitelist, `cookie-parser`, `ValidationPipe` (whitelist + transform), response được bọc `{ data }`.

### 2. Realtime Chat (Socket.IO)

- Chat 1-1 (Direct) và nhóm (Group), gateway xác thực JWT khi kết nối.
- Gửi/nhận tin nhắn realtime (`chat:new-message`), sửa, xóa, ghim tin nhắn, reply, reaction.
- Trạng thái online/offline (`user:online`, `user:offline`) qua heartbeat TTL Redis.
- Typing indicators đa thiết bị (`chat:typing-start` / `chat:typing-stop`).
- Read receipts với cascade trạng thái "seen" cho tin cũ (`chat:mark-read`).
- Quản lý tin chưa đọc bằng Redis Sets, tối ưu tránh spam sự kiện.
- Rate limit theo từng loại sự kiện socket.

### 3. Media, File & Voice Messages

- Gửi tin nhắn dạng **text / image / video / file / voice**.
- Lưu trữ trừu tượng qua **Cloudinary** (ảnh/avatar) và **Cloudflare R2** (video/file/voice) dùng `@aws-sdk/client-s3`.
- **Truy cập bằng signed URL có TTL 15 phút** (`SIGNED_URL_TTL_SECONDS = 900`):
  - **R2**: bucket để **private**, URL được tự ký theo chuẩn **AWS SigV4** (query-string) và hết hạn sau 15 phút.
  - **Cloudinary**: ảnh riêng tư dùng delivery type `authenticated`, ký lại mỗi lần trả về. Khi bật `auth_token` (gói trả phí) → TTL thật 15 phút; free tier chỉ ký chặn đoán link, không có TTL.
  - Client xin URL mới qua `GET /media/:id/url` khi URL cũ hết hạn.
- Endpoint tải file (`GET /media/:id/download`) có kiểm tra quyền truy cập; kiểm tra loại file thực (`file-type`) và giới hạn dung lượng theo loại.

### 4. Audio / Video Calls (WebRTC)

- Gọi 1-1 audio/video, vòng đời `CALLING → ACCEPTED/REJECTED/MISSED → ENDED`.
- Signaling SDP offer/answer + ICE candidate chuyển tiếp qua socket.
- TURN/STUN qua **Metered.ca**, credential được cache và tự xoay vòng trước khi hết hạn.
- Mỗi cuộc gọi tạo một tin nhắn hệ thống tổng kết (`CALL_AUDIO` / `CALL_VIDEO`).

### 5. Quan hệ người dùng

- Kết bạn (gửi / chấp nhận / hủy lời mời), hủy kết bạn, chặn / bỏ chặn.
- Gating tin nhắn từ người lạ (message request + accept flow).

### 6. Kiểm duyệt & Quản trị

- Người dùng gửi báo cáo kèm bằng chứng ảnh; admin xử lý, tính hình phạt, ban/mute thủ công hoặc nhanh.
- Luồng kháng cáo (appeal) cho người bị ban qua token ký riêng.
- **Audit log** bất biến cho hành động admin/hệ thống (event-driven).
- **Notifications** in-app (báo cáo, đăng nhập, hệ thống) + đẩy realtime.
- **Web Push** (VAPID) cho thông báo khi người dùng không online.
- **Stats**: dashboard tổng quan, health check (Mongo/Redis/Cloudinary/R2), biểu đồ theo ngày/tuần/tháng/năm.
- **Cleanup Jobs**: hàng đợi BullMQ retry cho side-effect (xóa media, dọn Redis, revoke session).

## Công nghệ sử dụng

- **NestJS 11** — `@nestjs/common`, `core`, `config`, `schedule` (cron), `event-emitter`, `throttler`
- **Realtime** — `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`
- **Database** — MongoDB + `@nestjs/mongoose` / `mongoose`
- **Cache/State** — Redis + `ioredis`
- **Queue** — `@nestjs/bullmq` + `bullmq`
- **Auth** — `passport` (`local`, `jwt`), `@nestjs/jwt`, `bcrypt`
- **Storage** — Cloudinary, Cloudflare R2 (`@aws-sdk/client-s3`), `file-type`
- **Mail** — Resend HTTP API + Handlebars templates
- **Push** — `web-push` (VAPID)
- **Security/Utils** — `helmet`, `cookie-parser`, `class-validator`, `class-transformer`, `uuid`
- **Docs** — Swagger (`@nestjs/swagger`)

## Kiến trúc & Module

```
src/
├── main.ts                # Bootstrap: global prefix, CORS, Swagger, helmet, SPA fallback
├── auth/                  # Login/register/OTP/Google, JWT & session, passport strategies, guards
├── mail/                  # Resend + Handlebars templates (register/forgot/verify-new-email)
├── redis/                 # RedisService (@Global): OTP, presence, typing, unseen, rate limit, cache
├── common/                # Constants, TransformInterceptor, ThrottlerUserIpGuard
├── utils/                 # Decorators (@Public, @Roles, @Cookies, @Match), hash/JWT/room helpers
└── modules/
    ├── audit-log/         # Nhật ký hành động admin/hệ thống (bất biến, event-driven)
    ├── calls/             # Vòng đời cuộc gọi audio/video, tin nhắn tổng kết
    ├── cleanup-jobs/      # Hàng đợi BullMQ retry cho media/redis/session cleanup
    ├── conversations/     # Hội thoại 1-1 & nhóm, admin nhóm, avatar, đọc/accept
    ├── media/             # Lưu trữ Cloudinary + R2, signed URL (TTL 15p), download, dọn orphan
    ├── messages/          # Text/image/video/file/voice, reaction, pin, reply, recall
    ├── notifications/     # Thông báo in-app + đẩy realtime
    ├── presence/          # Kiểm tra trạng thái online (Redis)
    ├── push-subscriptions/# Đăng ký Web Push theo user+device
    ├── realtime/          # Socket.IO gateway, WebRTC signaling & ICE config
    ├── relationships/     # Kết bạn / chặn
    ├── reports/           # Báo cáo, hình phạt, ban/mute, kháng cáo
    ├── session/           # Lớp lưu trữ phiên/thiết bị (nội bộ, không controller)
    ├── stats/             # Thống kê quản trị & health check
    └── users/             # Hồ sơ, tìm kiếm, quản lý user, role, avatar
```

**Đặc điểm kiến trúc:**

- Guard toàn cục `JwtAuthGuard` (bỏ qua bằng `@Public()`) + `ThrottlerUserIpGuard`.
- Phân quyền `@Roles(...)` với `UserRole`: `USER`, `ADMIN`, `SUPER_ADMIN`.
- Giao tiếp giữa domain và realtime qua RxJS Subjects + `EventEmitter2` → bridge phát ra socket.
- Response chuẩn hóa `{ data: <payload> }`; lỗi validation trả `422` với danh sách `errors`.

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

Các nhóm biến quan trọng (xem `.env.example` để có danh sách đầy đủ):

| Nhóm           | Biến                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App            | `PORT`, `NODE_ENV`, `CORS_ORIGINS`, `SYSTEM_ADMIN_ID`                                                                                                                             |
| MongoDB        | `MONGODB_URI`                                                                                                                                                                     |
| Google OAuth   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`                                                                                                                 |
| Redis          | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`                                                                                                                                      |
| JWT / Session  | `JWT_SECRET`, `JWT_EXPRIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN_DB`, `COOKIE_EXPIRES_IN`, `REFRESH_TOKEN_PEPPER`, `APPEAL_TOKEN_SECRET`, `APPEAL_TOKEN_EXPIRES_IN` |
| OTP            | `CODE_VERIFY_PEPPER`, `MAIL_CODE_ACTIVE_EXPIRE`, `MAIL_CODE_FORGOT_EXPIRE`, `MAIL_CODE_UPDATE_EMAIL_EXPIRE`                                                                       |
| Mail (Resend)  | `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_REGISTER_TEMPLATE`, `MAIL_FORGOT_TEMPLATE`, `MAIL_UPDATE_EMAIL_TEMPLATE`                                                                     |
| Cloudinary     | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_AUTH_TOKEN_ENABLED`, `CLOUDINARY_AUTH_TOKEN_KEY`                                              |
| Cloudflare R2  | `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_PUBLIC_BASE_URL`, `CLOUDFLARE_API_TOKEN`                                        |
| Storage limits | `CLOUDINARY_BANDWIDTH_LIMIT_GB`, `CLOUDINARY_STORAGE_LIMIT_GB`, `R2_STORAGE_LIMIT_GB`, `MONGO_MAX_STORAGE_MB`, `REDIS_MAX_MEMORY_MB`                                              |
| Web Push       | `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`                                                                                                                          |
| WebRTC         | `METERED_API_KEY`, `METERED_ICE_SERVERS_URL`                                                                                                                                      |

> Tạo cặp khóa VAPID: `npx web-push generate-vapid-keys`

## Chạy ứng dụng

Development:

```bash
npm run dev          # nest start --watch
```

Production:

```bash
npm run build
npm run start:prod   # node dist/main
```

Chạy bằng Docker:

```bash
docker build -t halochat-api .
docker run -p 8080:8080 --env-file .env halochat-api
```

## API & Realtime

### Swagger

Chỉ bật khi `NODE_ENV !== 'production'`:

- Swagger UI: `http://localhost:8080/swagger`
- Base API: `http://localhost:8080/api/v1`

### Flow test auth cơ bản

1. `POST /auth/login` để lấy `accessToken` và set cookie `refreshToken` + `deviceId`.
2. Bấm **Authorize**, nhập token dưới scheme `JWT-auth`.
3. Test `POST /auth/refreshToken`, `POST /auth/logout`, `POST /auth/logoutAll`.

### Một số nhóm endpoint chính

| Nhóm          | Ví dụ endpoint                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Auth          | `/auth/login`, `/auth/google`, `/auth/register`, `/auth/refreshToken`, `/auth/logout`, `/auth/devices` |
| Users         | `GET /users`, `GET /users/search`, `PATCH /users/me`, `PATCH /users/avatar`, `PATCH /users/:id/role`   |
| Conversations | `POST/GET /conversations`, `PATCH /conversations/:id/read`, `/add-members`, `/change-admin`            |
| Messages      | `POST /conversations/:id/message/{text,image,video,file,voice}`, `PATCH /messages/:id/reaction`        |
| Relationships | `GET/POST /relationships`, `PATCH /relationships/block`, `/:id/accept`                                 |
| Reports       | `POST /reports`, `PATCH /reports/:id/resolve`, `/appeal`                                               |
| Notifications | `GET /notifications`, `PATCH /notifications/read-all`                                                  |
| Push          | `POST /push/subscriptions`, `DELETE /push/subscriptions/:deviceId`                                     |
| Stats (admin) | `GET /stats/overview`, `GET /stats/health`, `GET /stats/chart`                                         |
| WebRTC        | `GET /realtime/webrtc/ice-servers`                                                                     |

### Sự kiện Socket.IO tiêu biểu

- **Chat**: `chat:join-conversation`, `chat:create-message`, `chat:mark-read`, `chat:typing-start/stop`, `chat:delete-message`, `chat:update-message` → phát `chat:new-message`, `message:updated`, `message:pinned`.
- **Presence**: `user:heartbeat` → `user:online`, `user:offline`, `user:typing-update`.
- **Calls (WebRTC)**: `call:start/accept/reject/end`, `call:offer/answer/ice-candidate` → `call:incoming`, `call:accepted`, `call:ended`.
- **Khác**: `notification:created`, `user:banned/muted`, `relationship:created/accepted`.

## Frontend (SPA)

Thư mục `client/` chứa bản build production của giao diện **HaloChat** (React/Vite, có PWA + service worker Web Push). Được phục vụ qua `ServeStaticModule` với middleware SPA fallback trong `main.ts` — mọi route GET không thuộc `/api/`, `/swagger`, `/assets/` sẽ trả `client/index.html`.

## Tài liệu tham khảo

- `docs/app-flow.md` — bản đồ trách nhiệm từng module + luồng auth/session chi tiết.
- `docs/e2ee_architecture.md` — thiết kế mã hóa đầu cuối (E2EE) dự kiến.
- `docs/plan.md`, `docs/plan2.md` — roadmap và ghi chú self-audit bảo mật/bug.
- `docs/query-mongo.md`, `docs/query-redis.md` — cheat sheet truy vấn.

## Gợi ý deploy free

- MongoDB: MongoDB Atlas (M0)
- Redis: Redis Cloud free
- Storage: Cloudinary free tier + Cloudflare R2 free tier
- TURN/STUN: Metered.ca free tier
- Backend: Hugging Face Spaces (Docker) hoặc Render free tier

## License

MIT
