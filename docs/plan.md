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
  Vô hiệu hóa tài khoản, chặn user

## Ưu tiên tiếp theo

### 1. Hoàn thiện flow `cleanup-jobs`

Đây là phần nên ưu tiên cao nhất ở thời điểm hiện tại vì:

- hệ thống đã bắt đầu tạo `cleanup-job` thật trong nhiều flow
- hiện tại mới chỉ lưu job, chưa có worker xử lý lại
- chưa có màn hoặc API cho admin quan sát job lỗi
- để lâu sẽ dễ quên ngữ cảnh của từng job hoặc bỏ sót lỗi tồn đọng

### 2. Push Notifications

- Tích hợp Firebase Cloud Messaging (FCM) hoặc Web Push.
- Đảm bảo user vẫn nhận được thông báo tin nhắn mới khi offline hoặc đóng trình duyệt.

### 3. Mã hóa E2EE

- thiết bị tin cậy

### 4. Phân tán server

### 5. Đăng nhập bên thứ 3

### 6. Tối ưu hiệu suất và scale

- Cài `@socket.io/redis-adapter` để hỗ trợ multi-instance khi deploy nhiều node.
- Chuẩn hóa thêm phần realtime event payload để dễ scale sang worker hoặc service khác.

############

validate đọc file ở be,
vấn đề bảo mật fe

thông báo về thiết bị mới đăng nhập

call, video

bảo mật admin fe out focus
