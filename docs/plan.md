## Kế hoạch phát triển tiếp theo

File này dùng để ghi lại các hướng triển khai tiếp theo của hệ thống, ưu tiên theo nhu cầu thực tế hiện tại của app chat và các phần vừa bổ sung gần đây.

## Trạng thái hiện tại đã xong

- Gửi message text qua HTTP và socket.
- Gửi media message:
    - ảnh dùng Cloudinary
    - video, file, voice dùng R2
- Upload avatar user và avatar conversation.
- Giải tán group chat và dọn media liên quan.
- Reaction cho tin nhắn.
- Đổi tên nhóm, đổi admin, thêm/xóa thành viên, rời nhóm.
- Soft delete message và update message qua socket.
- Presence, typing, unseen conversation trong Redis.
- Disable/enable user thay cho hard delete user.
- Đưa `cleanup-jobs` vào `media`, `redis`, `session` và các flow liên quan.

## Ưu tiên cao tiếp theo

### 1. Hoàn thiện flow `cleanup-jobs`

Đây là phần nên ưu tiên cao nhất ở thời điểm hiện tại vì:

- hệ thống đã bắt đầu tạo `cleanup-job` thật trong nhiều flow
- hiện tại mới chỉ lưu job, chưa có worker xử lý lại
- chưa có màn hoặc API cho admin quan sát job lỗi
- để lâu sẽ dễ quên ngữ cảnh của từng job hoặc bỏ sót lỗi tồn đọng

### 2. Push Notifications

- Tích hợp Firebase Cloud Messaging (FCM) hoặc Web Push.
- Đảm bảo user vẫn nhận được thông báo tin nhắn mới khi offline hoặc đóng trình duyệt.

### 3. Tối ưu hiệu suất và scale

- Cài `@socket.io/redis-adapter` để hỗ trợ multi-instance khi deploy nhiều node.
- Chuẩn hóa thêm phần realtime event payload để dễ scale sang worker hoặc service khác.

## Kế hoạch riêng cho `cleanup-jobs`

### 1. Mục tiêu

`cleanup-jobs` cần đi đủ 3 lớp:

1. ghi nhận job thất bại
2. retry lại có kiểm soát
3. cho admin quan sát và can thiệp khi cần

Hiện tại hệ thống mới làm được bước 1.

### 2. Trạng thái hiện tại

Đã có:

- schema lưu `status`, `resourceType`, `action`, `entityType`, `entityId`, `payload`, `retryCount`, `maxRetries`, `nextRetryAt`, `error`
- validate payload theo `action`
- các flow tạo job từ:
    - `MediaService`
    - `RedisService`
    - `SessionService`

Chưa có:

- worker retry tự động
- hàm execute job theo `action`
- chiến lược backoff
- API admin để list/filter/retry/ignore job
- dashboard hoặc log tổng hợp cho cleanup thất bại

### 3. Quy ước nghiệp vụ cần giữ

- `entityType` cho biết job phát sinh từ thực thể nào
- `entityId` là id của thực thể đó nếu tại thời điểm tạo job đã có id
- `entityId` có thể vắng mặt nếu flow lỗi xảy ra trước khi thực thể được tạo xong

Ví dụ:

- `USER_AVATAR`: job phát sinh từ user, `entityType = USER`, `entityId = userId`
- `CONVERSATION_AVATAR`: job phát sinh từ conversation, `entityType = CONVERSATION`, `entityId = conversationId`
- `MESSAGE_MEDIA`: job phát sinh từ flow tạo message, `entityType = MESSAGE`, có thể không có `entityId`
- `SESSION`: job phát sinh từ user đang bị revoke session, `entityType = USER`, `entityId = userId`

### 4. Hướng xử lý retry tự động (Event-driven với BullMQ)

Dựa trên ý tưởng dùng Redis Event (chia việc bằng delay/TTL) kết hợp MongoDB (lưu trữ phục vụ Admin), hệ thống sẽ tích hợp `@nestjs/bull` (hoặc BullMQ):

1. **Lúc sinh rác (Tạo Job):** 
   - Lưu thông tin vào MongoDB với `status = PENDING` / `RETRY` để Admin có thể xem được giao diện.
   - Đồng thời, đẩy `jobId` vào queue của Bull (Redis) kèm theo cấu hình `delay` (thời gian chờ đến mốc retry kế tiếp).
2. **Lúc thực thi (Zero-polling):** 
   - Khi thời gian `delay` kết thúc, BullMQ (Redis) sẽ tự động đánh thức Worker và ném `jobId` cho nó xử lý, hoàn toàn không cần Cron spam query xuống DB.
3. **Trong Worker (CleanupProcessor):**
   - Lấy `jobId` query MongoDB để lấy chi tiết payload cần dọn dẹp.
   - switch theo `action` và gọi hàm dọn dẹp tương ứng.
4. **Cập nhật lại DB sau khi chạy:**
   - Nếu thành công:
     - set `status = DONE`, set `resolvedAt`, clear `error`.
   - Nếu thất bại:
     - Tăng `retryCount`, set `lastTriedAt`, cập nhật `error`, tính `nextRetryAt`.
     - Đẩy lại `jobId` vào Bull Queue với `delay` của mốc thời gian mới.
   - Nếu vượt `maxRetries` (hoặc quá 7 ngày với Session):
     - set `status = FAILED`, không đẩy vào Queue nữa.

5. **Cơ chế Self-healing (Tự phục hồi chống lọt lưới):**
   - Vấn đề: Job tạo xong trong DB nhưng đẩy vào Bull Queue bị lỗi mạng, hoặc Bull bị sập làm trôi mất event. Job sẽ kẹt vĩnh viễn ở trạng thái `PENDING` hoặc `RETRY`.
   - Giải quyết: Chạy một hàm `@Cron` chu kỳ khoảng **30 phút** hoặc **1 tiếng / lần** (đủ thưa để không tốn tài nguyên DB, nhưng đủ nhanh để vớt các job liên quan bảo mật như Session lọt lưới).
   - Cách nhận diện rác lọt lưới: Query DB tìm các job thỏa mãn điều kiện `status IN ('PENDING', 'RETRY') AND nextRetryAt < now - khoảng_du_di_thời_gian (ví dụ: 10 phút)`.
   - Hành động: Lấy các `jobId` này ném lại vào Bull Queue với `delay = 0` (chạy ngay lập tức).

### 5. Gợi ý execute theo `action`

- `CLOUDINARY_DELETE_ONE`
    - gọi Cloudinary delete theo `payload.publicId`
- `CLOUDINARY_DELETE_MANY`
    - gọi Cloudinary batch delete theo `payload.publicIds`
- `R2_DELETE_ONE`
    - gọi R2 delete theo `payload.objectKey`
- `R2_DELETE_MANY`
    - gọi R2 batch delete theo `payload.objectKeys`
- `REDIS_REMOVE_UNSEEN_ONE`
    - xóa `conversationId` khỏi set unseen của `userId`
- `REDIS_REMOVE_UNSEEN_MANY`
    - xóa `conversationId` khỏi set unseen của từng `userId`
- `SESSION_REVOKE`
    - revoke session theo `payload.sessionId` và `payload.userId`
- `SESSION_REVOKE_ALL`
    - revoke toàn bộ session theo `payload.userId`

Lưu ý quan trọng:

- lúc retry không nên gọi lại các method `WithCleanup`
- nên gọi các method "thực thi thuần" để tránh retry lỗi lại tiếp tục sinh thêm cleanup job mới
- nếu hiện tại method thuần đang là `private`, nên tách một lớp executor hoặc public method nội bộ an toàn để worker dùng

### 6. Gợi ý chiến lược retry

Đề xuất mặc định:

- lần đầu tạo job:
    - `status = PENDING`
    - `retryCount = 0`
    - `maxRetries = 10`
    - `nextRetryAt = now`
- retry dùng exponential backoff (tối đa 10 lần, tổng thời gian kéo dài khoảng hơn 1 tuần):
    - lần 1: sau 5 phút (để xử lý lỗi mạng/hệ thống tạm thời)
    - lần 2: sau 15 phút
    - lần 3: sau 1 giờ (chờ hệ thống tự phục hồi nếu có sự cố nhỏ)
    - lần 4: sau 4 giờ
    - lần 5: sau 12 giờ (chờ sự can thiệp của admin/DevOps trong ngày)
    - lần 6: sau 24 giờ (1 ngày)
    - lần 7: sau 48 giờ (2 ngày)
    - lần 8: sau 72 giờ (3 ngày)
    - lần 9: sau 96 giờ (4 ngày)
    - lần 10: sau 168 giờ (7 ngày - mốc cuối cùng, nếu vẫn lỗi sẽ dừng hoàn toàn)

Có thể thiết kế linh hoạt (tùy biến `maxRetries` và cấu hình mốc thời gian theo `resourceType` hoặc `action`):

- **Cloudinary / R2 (Media):** Dùng chiến lược giãn thời gian 7 ngày (10 lần) như cấu hình mặc định ở trên.
- **Redis unseen:** Lỗi ảnh hưởng tới trải nghiệm realtime (ví dụ: hiển thị sai badge số tin chưa đọc), nhưng không mang tính chí mạng vì user mở nhóm chat ra là tự động reset.
    - **Chiến lược:** 10 lần retry gói gọn trong khoảng **1.5 đến 2 tiếng**.
    - **Mốc thời gian:** 1 phút, 2 phút, 3 phút, 5 phút, 10 phút, 10 phút, 15 phút, 15 phút, 30 phút, 30 phút. (Tổng cộng khoảng 121 phút).
    - **Lý do:** Dữ liệu unseen mang tính thời điểm. Nếu Redis lỗi quá 2 tiếng thì dữ liệu này đã "cũ", user có thể đã vào đọc tin nhắn từ thiết bị khác rồi, nên cố cập nhật lại không còn ý nghĩa. Quá thời gian này thì cứ đánh dấu `FAILED` hoặc bỏ qua luôn.
- **Session revoke (Bảo mật - ƯU TIÊN ĐẶC BIỆT):**
    - **Lý do:** Access token sống 1 ngày, Refresh token sống 7 ngày. Nếu chờ vài ngày mới retry, user bị lộ token vẫn có thể tiếp tục truy cập.
    - **Chiến lược:** Cố định thời gian retry ngắn (ví dụ: mỗi **10 phút** một lần).
    - **Max retries:** Tăng cực lớn (ví dụ: `1008` lần ~ đúng 7 ngày) HOẶC không dùng `maxRetries` mà kiểm tra `createdAt` của job, nếu đã trôi qua 7 ngày thì ngừng (vì đằng nào refresh token ngoài thực tế cũng đã hết hạn, không cần thu hồi nữa).

## Kế hoạch flow dọn dẹp cho admin

### 1. Mục tiêu của admin flow

Admin cần có khả năng:

- xem job nào đang lỗi
- biết job đó phát sinh từ đâu
- biết payload cleanup là gì
- retry tay khi cần
- bỏ qua job nếu xác nhận không cần xử lý nữa
- theo dõi thống kê job lỗi để phát hiện vấn đề hệ thống

### 2. API admin nên có

Đề xuất các API chỉ cho `ADMIN`:

- `GET /cleanup-jobs`
    - list job
    - filter theo `status`, `resourceType`, `action`, `entityType`
    - search theo `entityId`
- `GET /cleanup-jobs/:id`
    - xem chi tiết 1 job
- `POST /cleanup-jobs/:id/retry`
    - retry tay 1 job
- `POST /cleanup-jobs/retry-bulk`
    - retry hàng loạt theo filter
- `PATCH /cleanup-jobs/:id/ignore`
    - đánh dấu bỏ qua
- `PATCH /cleanup-jobs/:id/fail`
    - đánh dấu failed thủ công nếu muốn chốt không retry nữa

### 3. Dữ liệu admin cần nhìn thấy

Ở màn chi tiết job, nên hiện:

- `status`
- `resourceType`
- `action`
- `entityType`
- `entityId`
- `payload`
- `retryCount`
- `maxRetries`
- `lastTriedAt`
- `nextRetryAt`
- `error`
- `createdAt`
- `updatedAt`
- `resolvedAt`

### 4. Hướng xử lý dành cho admin theo từng nhóm job

- Avatar user lỗi cleanup:
    - admin nhìn ra user nào bị ảnh hưởng qua `entityId`
    - có thể retry xóa file cũ
- Avatar conversation lỗi cleanup:
    - admin nhìn ra conversation nào bị ảnh hưởng
    - có thể retry xóa ảnh nhóm cũ
- Message media lỗi cleanup:
    - admin biết job phát sinh từ flow tạo message
    - nếu không có `entityId` vẫn dùng `payload.publicId` hoặc `payload.objectKey` để xử lý
- Unseen conversation:
    - admin chỉ nên retry nếu có bug tồn đọng hoặc cần đồng bộ lại trạng thái
- Session revoke:
    - cần ưu tiên retry sớm vì đây là phần liên quan bảo mật

### 5. Luồng xử lý admin được đề xuất

1. admin mở màn danh sách cleanup jobs
2. lọc `status = FAILED` hoặc `status = RETRY`
3. mở chi tiết job để xem:
    - job phát sinh từ đâu
    - payload nào sẽ được dùng để xử lý lại
    - đã retry bao nhiêu lần
    - lỗi gần nhất là gì
4. chọn một trong các hành động:
    - retry ngay
    - ignore
    - để worker tự retry theo lịch

### 6. Quy tắc bảo vệ admin flow

- chỉ `ADMIN` mới truy cập được
- mọi action retry/ignore nên có audit log
- không cho sửa tùy ý `payload` trực tiếp từ UI ở giai đoạn đầu
- nếu cho phép retry bulk, cần giới hạn số lượng mỗi lần
- session cleanup nên log rõ người thao tác vì liên quan security

## Kế hoạch riêng cho admin

### 1. Flow vào `/admin`

Trước khi vào bất kỳ trang nào thuộc `/admin`, FE cần bắt buộc confirm lại mật khẩu bằng endpoint `PATCH /auth/confirm-password` trong `auth.controller.ts`.

- Nếu confirm thành công thì mới cho vào admin area.
- Nếu confirm thất bại thì không mở dashboard admin.
- Cần có thời gian hết hạn cho phiên confirm này, không nên cấp quyền admin vĩnh viễn.
- Khi logout hoặc token hết hạn thì phải confirm lại.

### 2. Phạm vi admin backend

Admin FE cần có các nhóm chức năng sau, đối chiếu trực tiếp với backend hiện tại:

- Quản lý user.
- Quản lý cleanup jobs.
- Xem danh sách các flow backend đang có để quyết định roadmap admin cho đủ độ phủ chức năng.

### 3. Các chức năng backend hiện có cần liệt kê trong admin

- Auth: login, refresh token, logout, logout all devices, change password, confirm password, forgot password, reset password.
- Users: list user, xem chi tiết user, tạo user, cập nhật thông tin user, upload avatar, xóa avatar, disable/enable user.
- Conversations: tạo conversation, group management, add/remove member, change admin, rename group, leave group, reaction, soft delete message, update message qua socket.
- Messages: gửi text, gửi media, upload media, download media, download R2, xóa media liên quan.
- Media: upload/xóa Cloudinary, upload/xóa R2, cleanup media sau khi xác nhận lỗi.
- Presence & typing: set presence, get presence, typing state, online list.
- Redis unseen: set/remove unseen conversation, remove all unseen theo conversation.
- Session: revoke session, revoke all session, cleanup session khi có lỗi.
- Cleanup jobs: create job, list job, xem chi tiết job, list job chưa xử lý, process tay job.

### 4. Gói giao diện admin nên có

- Dashboard tổng quan.
- User management.
- Cleanup job management.
- Log / audit action cho các thao tác nhạy cảm.
- Trang confirm password riêng trước khi vào admin.

## Các việc kỹ thuật nên làm ngay sau khi có worker

### 1. Tách executor riêng

Nên có lớp kiểu:

- `CleanupJobExecutorService`

Mục tiêu:

- tách logic `switch(action)` ra khỏi `CleanupJobsService`
- tránh `CleanupJobsService` phình quá nhanh
- dễ test unit cho từng action

### 2. Thêm test cho cleanup

Cần có test cho:

- validate payload theo action
- create job thành công
- retry thành công thì đổi `status = DONE`
- retry thất bại thì tăng `retryCount`
- vượt `maxRetries` thì thành `FAILED`
- `MESSAGE_MEDIA` không có `entityId` vẫn hợp lệ

### 3. Thêm thống kê

Nên có thống kê:

- số job `PENDING`
- số job `RETRY`
- số job `FAILED`
- top action lỗi nhiều nhất
- top resource lỗi nhiều nhất

## Các hạng mục khác nên tiếp tục

- Pagination
- Hoàn thiện payload chuẩn cho socket response và broadcast event.
- Bổ sung `lastOnlineAt` vào database qua `UsersService`.
- Tối ưu thêm `RedisService` và các flow realtime nhiều tab/thiết bị.
- Xem xét bổ sung push notification sau khi phần cleanup ổn định.

## Thứ tự triển khai đề xuất

1. Hoàn thiện `cleanup-jobs` worker retry.
2. Tách executor cho từng `action`.
3. Bổ sung API admin cho cleanup jobs.
4. Bổ sung test cho cleanup flow.
5. Thêm thống kê và dashboard cơ bản cho admin.
6. Sau đó mới đẩy mạnh push notification và scale realtime.
