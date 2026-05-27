# 🚀 Learn-NestJS - Hệ Thống Xác Thực Người Dùng Toàn Diện

Một hệ thống xác thực người dùng bảo mật cao, mạnh mẽ và chuyên nghiệp được xây dựng bằng **NestJS**, **MongoDB (Mongoose)**, **Passport (JWT & Local)** và **Nodemailer**, hỗ trợ tài liệu hóa API đầy đủ bằng **Swagger UI**.

---

## 🌟 Tính Năng Nổi Bật

*   **Đăng Ký & Kích Hoạt Tài Khoản:**
    *   Đăng ký tài khoản mới với chức năng khớp mật khẩu (xác thực dữ liệu ở tầng DTO).
    *   Tự động tạo mã kích hoạt tài khoản và gửi qua Email bằng template HTML cực kỳ đẹp mắt.
    *   API kích hoạt tài khoản công khai (xác thực bằng Email + Mã kích hoạt).
    *   Chức năng gửi lại mã kích hoạt an toàn, được bảo vệ chống spam bằng **thời gian chờ (Cooldown) 60 giây**.
*   **Bảo Mật & Xác Thực:**
    *   Đăng nhập bằng chiến lược Passport Local.
    *   Tự động kiểm tra thông tin tài khoản và xác thực trạng thái kích hoạt (`isActive`).
    *   Cơ chế xác thực hai token (Double-token JWT): `AccessToken` (hạn dùng ngắn) và `RefreshToken` (được lưu trong Cookie **30 ngày** để hỗ trợ dọn dẹp token hết hạn trong DB tự động).
    *   Đăng xuất an toàn, thu hồi các token đang hoạt động trong DB.
*   **Quản Lý Mật Khẩu:**
    *   Đổi mật khẩu cho người dùng đã đăng nhập, tự động lấy ID an toàn từ JWT Token của request.
    *   Yêu cầu Quên mật khẩu gửi mã xác minh (OTP) về Email người dùng qua template gradient hồng-đỏ sang trọng, chống spam click bằng **thời gian chờ 60 giây**.
    *   Đặt lại mật khẩu mới (Reset Password) bằng cách xác thực mã OTP, kiểm tra thời gian hết hạn và mã hóa mật khẩu mới bằng `bcrypt`.
*   **Tài Liệu API:**
    *   Giao diện tài liệu trực quan bằng **Swagger UI**, tích hợp sẵn nút xác thực Bearer Token (JWT Auth) để test trực tiếp trên trình duyệt.

---

## 🛠️ Công Nghệ Sử Dụng

*   **Framework chính:** NestJS (v11+)
*   **Cơ sở dữ liệu:** MongoDB kết nối qua `@nestjs/mongoose`
*   **Bảo mật & Xác thực:** Passport, `passport-jwt`, `passport-local`, `bcrypt`
*   **Kiểm tra dữ liệu đầu vào:** `class-validator`, `class-transformer`
*   **Gửi Email:** `@nestjs-modules/mailer` kết hợp adapter template Handlebars (`HandlebarsAdapter`)
*   **Tài liệu API:** `@nestjs/swagger` kết hợp giao diện Swagger UI

---

## 🚀 Hướng Dẫn Cài Đặt & Chạy Thử

### 1. Tải mã nguồn & Cài đặt thư viện
```bash
# Clone dự án từ Github
git clone https://github.com/quanvu201120/Learn-NestJS.git
cd Learn-NestJS

# Cài đặt các thư viện cần thiết
npm install
```

### 2. Cấu hình Biến Môi Trường (Environment Variables)
Sao chép file `.env.example` thành file `.env` và điền đầy đủ thông số kết nối Database (MongoDB) cũng như cấu hình SMTP gửi email của bạn:
```bash
cp .env.example .env
```

Nội dung file `.env` tham khảo:
```env
#CONFIG MONGODB
PORT=8080
MONGODB_URI=mongodb://username:password@localhost:27017/database_name?authSource=admin

#CONFIG JWT
JWT_SECRET=your_jwt_secret_here
JWT_EXPRIRES_IN=1d
JWT_REFRESH_SECRET=your_jwt_refresh_secret_here
JWT_REFRESH_EXPIRES_IN_DB=7d
COOKIE_EXPIRES_IN=30d

#CONFIG MAIL
MAIL_USER=your_email@gmail.com
MAIL_PASS=your_email_app_password
MAIL_CODE_ACTIVE_EXPIRE=1h
MAIL_CODE_FORGOT_EXPIRE=5m
MAIL_FROM='"No Reply" <noreply@example.com>'
MAIL_REGISTER_TEMPLATE=register
MAIL_FORGOT_TEMPLATE=forgot-password
```

### 3. Chạy Ứng Dụng

```bash
# Chạy ở chế độ Phát triển (Development - tự động reload khi sửa file)
npm run dev

# Chạy ở chế độ Debug
npm run start:debug

# Biên dịch và chạy ở chế độ Production
npm run build
npm run start:prod
```

---

## 📖 Tài Liệu API (Swagger UI)

Khi server đã khởi động thành công, bạn có thể truy cập vào giao diện tài liệu API trực quan để khám phá và kiểm tra (test) trực tiếp các endpoint ngay trên trình duyệt:

👉 **Đường dẫn:** [http://localhost:8080/swagger](http://localhost:8080/swagger)

### Hướng dẫn test API có bảo mật trên Swagger:
1. Gọi API `POST /auth/login` để lấy mã `accessToken`.
2. Click vào nút **"Authorize"** màu xanh lá ở góc trên bên phải giao diện Swagger UI.
3. Dán mã `accessToken` vừa nhận được vào và xác nhận.
4. Giờ đây bạn đã có thể test trực tiếp các API cần đăng nhập (như đổi mật khẩu, đăng xuất...) một cách cực kỳ dễ dàng!

---

## 🛡️ Bản Quyền (License)

Dự án này được cấp phép theo tiêu chuẩn [MIT licensed](LICENSE).
