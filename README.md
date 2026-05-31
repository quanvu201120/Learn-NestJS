# Learn NestJS - Authentication API (MongoDB + Redis OTP)

Dự án API xác thực người dùng xây dựng bằng **NestJS**, sử dụng **MongoDB** để lưu dữ liệu nghiệp vụ và **Redis** để lưu OTP/mã xác thực theo TTL.

---

## 1) Tính năng chính

- Đăng ký tài khoản, kích hoạt qua email.
- Đăng nhập bằng `passport-local` + JWT.
- Cấp `accessToken` + `refreshToken`.
- Lưu danh sách refresh token (đã hash) trong MongoDB.
- Quên mật khẩu / đặt lại mật khẩu bằng OTP.
- OTP được lưu trên Redis theo TTL:
  - `auth:active:${userId}`
  - `auth:forgot:${userId}`
- Giới hạn resend code bằng cơ chế cooldown dựa trên TTL Redis.
- Swagger UI để test API trực tiếp.

---

## 2) Công nghệ sử dụng

- NestJS 11
- MongoDB + Mongoose
- Redis + ioredis
- Passport (`local`, `jwt`)
- JWT (`@nestjs/jwt`)
- Mailer (`@nestjs-modules/mailer` + Handlebars)
- Swagger (`@nestjs/swagger`)

---

## 3) Cài đặt dự án

```bash
git clone https://github.com/quanvu201120/Learn-NestJS.git
cd Learn-NestJS
npm install
```

---

## 4) Cấu hình môi trường

Tạo `.env` từ file mẫu:

```bash
cp .env.example .env
```

Các biến quan trọng:

- **App**: `PORT`
- **MongoDB**: `MONGODB_URI`
- **Redis**: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- **JWT**: `JWT_SECRET`, `JWT_EXPRIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN_DB`
- **Cookie/JWT hardening**: `COOKIE_EXPIRES_IN`, `REFRESH_TOKEN_PEPPER`
- **OTP hardening**: `CODE_VERIFY_PEPPER`
- **Mailer**: `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM`, `MAIL_REGISTER_TEMPLATE`, `MAIL_FORGOT_TEMPLATE`
- **TTL OTP**: `MAIL_CODE_ACTIVE_EXPIRE`, `MAIL_CODE_FORGOT_EXPIRE`

> Lưu ý: key `JWT_EXPRIRES_IN` đang được giữ nguyên theo code hiện tại.

---

## 5) Chạy ứng dụng

### Development

```bash
npm run dev
```

### Build production

```bash
npm run build
npm run start:prod
```

---

## 6) Swagger API Docs

Sau khi chạy app:

- Swagger UI: `http://localhost:8080/swagger`
- API base prefix: `http://localhost:8080/api/v1`

Trong Swagger:

1. Gọi `POST /auth/login` để lấy `accessToken`.
2. Bấm **Authorize**.
3. Nhập token theo format: `Bearer <accessToken>`.
4. Test các endpoint cần xác thực.

---

## 7) Redis OTP flow (tóm tắt)

1. Khi register/create user:
   - sinh OTP
   - hash OTP + `CODE_VERIFY_PEPPER`
   - lưu Redis với TTL
   - gửi mail bất đồng bộ
2. Khi verify/reset:
   - đọc hash từ Redis
   - so khớp hash
   - đúng thì xóa key ngay (one-time use)
3. Khi resend:
   - kiểm tra cooldown qua TTL còn lại

---

## 8) Gợi ý deploy free

- **MongoDB**: MongoDB Atlas (M0 free)
- **Redis**: Redis Cloud free
- **Backend**: Koyeb/Render free tier

---

## License

MIT
