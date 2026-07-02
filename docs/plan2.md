# Kế hoạch triển khai Thống kê (Daily Stats) cho Admin Dashboard

Mục tiêu: Áp dụng mô hình Lai (Hybrid) - tự đếm số liệu theo ngày bằng Database, lấy cấu hình Real-time từ Redis và lấy băng thông tải xuống từ API của Cloudinary & Cloudflare R2 kết hợp Cron Job cập nhật liên tục mỗi 15 phút vào bảng thống kê ngày.

## 1. Cơ chế hoạt động (Hybrid)
1. **Biểu đồ theo ngày (Upload, Tin nhắn, User, Login, Cloud Usage, Redis):** Tất cả các thông số đều được gom về và lưu chung vào bảng `SystemDailyStat` trong DB theo từng ngày. Khi có upload/tin nhắn, tự động ghi nhận số liệu.
2. **Riêng phần Download (Bandwidth) và Redis Peak:** Tạo một **Cron Job chạy mỗi 15 phút**. Job này sẽ gọi API của Cloudinary, R2 để lấy "Tổng dung lượng Download & Storage" của tháng, so sánh với ngày hôm qua để lấy ra độ lệch (delta) cập nhật vào ngày hôm nay. Đồng thời lấy thông số RAM/Connections cao nhất của Redis lưu vào ngày hôm nay.
3. **Chỉ số hệ thống (Redis):** Tình trạng hoạt động của Redis sẽ được lấy Real-time (không lưu vào DB) mỗi khi Admin gọi API Overview.

## 2. Các thay đổi dự kiến

### Stats Module
Tạo thư mục `src/modules/stats` với kiến trúc 1 Module quản lý 1 Schema:

```text
src/
└── modules/
    └── stats/
        ├── schemas/
        │   └── system-daily-stat.schema.ts        <-- Bảng 1: Đếm thao tác nội bộ & Lưu Cloud/Redis usage
        ├── cron/
        │   └── stats.cron.ts                      <-- Job chạy ngầm mỗi 15 phút
        ├── stats.controller.ts                    <-- API Dashboard
        ├── stats.service.ts                       <-- Logic lưu trữ DB
        └── stats.module.ts                        <-- Đóng gói Module
```

#### `schemas/system-daily-stat.schema.ts`
Khai báo Mongoose schema cho bảng `SystemDailyStat`:
- `date`: String (Format `YYYY-MM-DD`, unique index - làm khóa chính cho mỗi ngày).
- `newUsers`: Number (mặc định 0).
- `logins`: Number (mặc định 0).
- `newGroups`: Number (mặc định 0).
- `newDirects`: Number (mặc định 0).
- `messagesText`: Number (mặc định 0).
- `messagesImage`: Number (mặc định 0).
- `messagesVideo`: Number (mặc định 0).
- `messagesFile`: Number (mặc định 0).
- `messagesVoice`: Number (mặc định 0).
- `uploadBytesCloudinary`: Number (mặc định 0) - tổng dung lượng upload lên Cloudinary.
- `uploadBytesR2`: Number (mặc định 0) - tổng dung lượng upload lên R2.
- `cloudinaryBandwidthBytes`: Number (mặc định 0) - tổng băng thông tải xuống trên Cloudinary trong ngày.
- `cloudinaryStorageBytes`: Number (mặc định 0) - dung lượng lưu trữ max trên Cloudinary trong ngày.
- `r2BandwidthBytes`: Number (mặc định 0) - tổng băng thông tải xuống trên R2 trong ngày.
- `r2StorageBytes`: Number (mặc định 0) - dung lượng lưu trữ max trên R2 trong ngày.
- `redisPeakMemoryBytes`: Number (mặc định 0) - RAM cao nhất Redis sử dụng trong ngày.
- `redisPeakClients`: Number (mặc định 0) - kết nối cao nhất Redis nhận được trong ngày.

#### `stats.service.ts`
Chứa các logic đếm:
- `incrementNewUser()`, `incrementLogin()`, `incrementNewGroup()`, `incrementNewDirect()`, `incrementMessage(type: string)`, `incrementUploadBytes(provider: 'cloudinary' | 'r2', bytes: number)`: 
  Sử dụng `Model.updateOne({ date: today }, { $inc: { field: 1 } }, { upsert: true })`.

#### `stats.controller.ts`
Cung cấp API cho trang Admin Dashboard (bảo vệ bởi `@Roles('ADMIN')`):
- `GET /stats/overview`: Lấy số liệu tổng cộng dồn (Tổng messages, uploads, users,...), số liệu Cloud của tháng hiện tại (lấy từ dữ liệu cộng dồn của ngày gần nhất), và thực thi `redis.info()` để lấy thông số RAM/Connections real-time của Redis trả về.
- `GET /stats/chart`: Lấy mảng số liệu từ bảng `SystemDailyStat` để vẽ biểu đồ. Cho phép filter theo query: `?type=daily|monthly|yearly`, `startDate`, `endDate`, `limit`.
- `POST /stats/sync`: API cập nhật thủ công. Lấy tức thời dữ liệu Cloud & Redis lưu vào bảng `SystemDailyStat` của ngày hôm nay.

#### `cron/stats.cron.ts`
Sử dụng `@nestjs/schedule` để cài đặt Cron Job.
- `@Cron('*/15 * * * *')` (Chạy tự động mỗi 15 phút).
- Logic `handleCloudUsageTracking`: 
  1. Gọi `cloudinary.api.usage()`.
  2. Dùng `fetch` gọi Cloudflare GraphQL Analytics API để lấy băng thông của R2.
  3. Lấy con số trả về trừ đi con số cộng dồn của ngày hôm qua để ra mức độ sử dụng của riêng ngày hôm nay.
  4. Cập nhật vào bản ghi ngày hôm nay trong `SystemDailyStat`.
- Logic `handleRedisPeakTracking`: Lấy info Redis để lấy max memory/clients trong ngày.

#### `stats.module.ts`
Khai báo module, import Mongoose Model của `SystemDailyStat`, export `StatsService`.

---

### Cập nhật các module hiện có

#### `src/app.module.ts`
Import `StatsModule` và kích hoạt `ScheduleModule.forRoot()`. Bổ sung biến môi trường `CLOUDFLARE_API_TOKEN` và `CLOUDFLARE_ACCOUNT_ID` vào `.env`.

#### `src/modules/users/users.module.ts` & `src/modules/users/users.service.ts`
- Import `StatsModule`. Trong hàm tạo user mới, gọi `this.statsService.incrementNewUser()`.

#### `src/modules/conversations/conversations.module.ts` & `src/modules/conversations/conversations.service.ts`
- Import `StatsModule`. Trong hàm `createConversation`, gọi `incrementNewGroup()` hoặc `incrementNewDirect()`.

#### `src/modules/messages/messages.module.ts` & `src/modules/messages/messages.service.ts`
- Import `StatsModule`. Trong hàm tạo tin nhắn, gọi `this.statsService.incrementMessage(message.type)`.

#### `src/modules/media/media.module.ts` & `src/modules/media/media.service.ts` & Providers
- Bổ sung hàm call API GraphQL vào `r2.service.ts` và hàm `usage()` vào `cloudinary.service.ts`.
- Lúc upload thành công, gọi `this.statsService.incrementUploadBytes(provider, file.size)`.

#### `src/auth/auth.service.ts`
Khi xác thực login thành công, gọi `this.statsService.incrementLogin()`.
