### Đề xuất phát triển tiếp theo (Next Steps)

Dựa trên cấu trúc app và các tính năng đã hoàn thiện, dưới đây là các tính năng nên được ưu tiên phát triển để hệ thống hoàn chỉnh hơn:

2. **Push Notifications (Thông báo nền)**
    - Tích hợp Firebase Cloud Messaging (FCM) hoặc Web Push.
    - Đảm bảo user nhận được thông báo tin nhắn mới ngay cả khi offline hoặc đóng trình duyệt.

3. **Tối ưu Hiệu suất & Scale (Performance)**
    - **Redis Adapter**: Cài đặt `@socket.io/redis-adapter` để hỗ trợ chạy multi-instance (khi deploy qua Docker Swarm / K8s).

#### XONG **\*\***\*\***\*\***\*\***\*\***\*\***\*\***\*\*\*\***\*\***\*\***\*\***\*\***\*\***\*\***\*\***

- **Message Actions Nâng cao**
    - message create media r2: video, file, audio voice
    - cloudinary: image

Conversation disban group - delete all media

upload avatar: user, conversation

- Pagination: Áp dụng cursor-based pagination cho API load tin nhắn để hỗ trợ Infinite Scroll, thay vì load toàn bộ.
- Thả cảm xúc (Reactions) cho tin nhắn.
- Đổi tên group
- Update Message
- Change admin
- Thêm/Xóa/Kick thành viên khỏi nhóm, rời nhóm.
  Thu hồi tin nhắn (Recall/Delete message for everyone).
- Reply tin nhắn (Threading/Quoted messages).
- Cập nhật hiển thị "Hoạt động X phút trước" (Last seen) dựa trên lần cuối user ping heartbeat.
- Fix lỗi chỉ trả về ID khi có tin nhắn reply (Đã populate đầy đủ `senderId` và `replyTo` khi khởi tạo tin nhắn mới).
- Refactor chuẩn hóa Data Types cho Socket (chia rõ Response và Broadcast Event Payload).
- Bổ sung event `user:unseen-cleared` giúp đồng bộ việc xóa thông báo unseen giữa nhiều tab/thiết bị của cùng một user.
- Tối ưu `RedisService` (chặn lỗi khi mảng userIds rỗng, sử dụng hằng số `HEARTBEAT_INTERVAL`).
- Cập nhật thời gian `lastOnlineAt` vào Database thông qua `UsersService`.
- Bổ sung các Socket Event (`conversation:group-created`, `conversation:member-added`, `conversation:member-removed`, `conversation:disbanded`, `conversation:restored`) hỗ trợ realtime cập nhật trạng thái Group Chat và khôi phục trò chuyện 1-1.
- Xử lý logic liên quan đến `hiddenHistory` trong `ConversationsService` khi thao tác với Group Chat (thêm member) hoặc khi khôi phục chat 1-1.
- Gửi tin nhắn hệ thống (System Message) tự động khi có thành viên được thêm, bị xóa hoặc tự rời khỏi Group Chat.
