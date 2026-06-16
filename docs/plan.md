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

### 4. Hướng xử lý retry tự động

Nên triển khai một worker hoặc cron nội bộ theo hướng sau:

1. lấy các job có `status = PENDING | RETRY` và `nextRetryAt <= now`
2. chuyển tạm sang trạng thái đang xử lý, hoặc dùng khóa để tránh chạy trùng
3. switch theo `action`
4. gọi đúng service tương ứng để xử lý lại
5. nếu thành công:
   - set `status = DONE`
   - set `resolvedAt`
   - clear `error`
6. nếu thất bại:
   - tăng `retryCount`
   - set `lastTriedAt`
   - cập nhật `error`
   - tính `nextRetryAt`
7. nếu vượt `maxRetries`:
   - set `status = FAILED`

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
- retry dùng exponential backoff:
  - lần 1: sau 1 phút
  - lần 2: sau 5 phút
  - lần 3: sau 15 phút
  - lần 4 trở đi: tăng dần tới mức trần, ví dụ 1 giờ

Có thể tách theo loại job:

- Cloudinary/R2:
  - retry sớm hơn vì chủ yếu là lỗi mạng hoặc provider tạm thời
- Redis unseen:
  - retry nhanh vì ảnh hưởng trải nghiệm realtime
- Session revoke:
  - retry ưu tiên cao vì liên quan bảo mật

### 7. Gợi ý validate chặt hơn

Hiện tại mới validate payload theo `action`. Nên bổ sung validate chéo:

- `action` nào đi được với `resourceType` nào
- `resourceType` nào đi được với `entityType` nào
- trường hợp nào `entityId` bắt buộc phải có
- trường hợp ngoại lệ nào cho phép `entityId` rỗng

Ví dụ:

- `MESSAGE_MEDIA` + `entityType = MESSAGE`:
  - cho phép thiếu `entityId`
- `USER_AVATAR` + `entityType = USER`:
  - nên bắt buộc có `entityId`
- `CONVERSATION_MEDIA` + `entityType = CONVERSATION`:
  - nên bắt buộc có `entityId`

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

- Pagination: áp dụng cursor-based pagination chuẩn hơn cho API load tin nhắn để hỗ trợ infinite scroll.
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
