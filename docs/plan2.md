## Kế hoạch: MVP gọi thoại và video 1-1

### Mục tiêu
Làm `gọi thoại 1-1` trước, rồi mở rộng cùng flow đó sang `video 1-1`, trong khi vẫn giữ nguyên logic chặn/thành viên hiện có.

### Phạm vi
- Chỉ làm `1-1`.
- Không làm gọi nhóm.
- Chưa dùng SFU/media server.
- Ban đầu chưa cần TURN.
- NestJS chỉ dùng để signaling.
- WebRTC trên client sẽ truyền media.

### Bước 1: Rà lại và tận dụng realtime hiện có
- Tận dụng socket gateway đang có trong `src/modules/realtime/chat.gateway.ts`.
- Tận dụng luôn luồng xác thực auth/session ở phần kết nối socket.
- Tận dụng các kiểm tra block quan hệ và membership cuộc trò chuyện hiện tại.

### Bước 2: Thêm model miền dữ liệu cho cuộc gọi
- Tạo `Call` model/schema riêng, không trộn dữ liệu cuộc gọi vào `messages`.
- Lưu các dữ liệu riêng cho cuộc gọi như người gọi, người nhận, conversation, loại cuộc gọi, trạng thái, thời điểm, và thời lượng.
- Giữ nguyên dữ liệu message như cũ.

### Bước 3: Thêm lớp service cho call
- Tạo service/module riêng để tạo call và cập nhật trạng thái.
- Gom toàn bộ rule vào một chỗ:
  - user tồn tại
  - user đã được xác thực
  - user không bị ban/disable
  - hai user không chặn nhau
  - user được phép tham gia conversation

### Bước 4: Thêm các event signaling qua WebSocket
- Thêm các socket event:
  - `call:start`
  - `call:accept`
  - `call:reject`
  - `call:end`
  - `call:offer`
  - `call:answer`
  - `call:ice-candidate`
- Giữ NestJS chỉ làm cầu nối signaling.
- Không truyền audio/video qua NestJS.

### Bước 5: Triển khai gọi thoại 1-1
- Trên client, chỉ xin quyền microphone.
- Dùng `RTCPeerConnection` với STUN.
- Đảm bảo gọi thoại có thể kết nối giữa 2 thiết bị/mạng khác nhau trong mức có thể.

### Bước 6: Mở rộng cùng flow đó sang gọi video 1-1
- Tái sử dụng cùng luồng signaling và lưu call.
- Đổi media constraints ở client để thêm camera.
- Giữ `callType` là `audio | video`.

### Bước 7: Hiển thị lịch sử cuộc gọi trong màn hình chat
- Lưu message và call riêng biệt.
- Khi mở chat detail thì load cả hai nguồn.
- Gộp theo `createdAt` ở client hoặc qua endpoint timeline.
- Render các dòng call như item trong timeline chat.

### Bước 8: Thêm xử lý vòng đời cơ bản
- Xử lý missed call.
- Xử lý timeout.
- Xử lý ended call.
- Lưu duration và status cuối cùng.

### Bước 9: Test theo mức độ thực tế tăng dần
- Localhost.
- Hai thiết bị cùng Wi-Fi.
- Hai mạng khác nhau.
- Mobile data so với Wi-Fi.

### Bước 10: Chỉ thêm TURN khi thật sự cần
- Bắt đầu với STUN בלבד.
- Thêm TURN sau nếu có mạng không kết nối ổn định.
- Để giá trị STUN/TURN trong env để đổi config mà không phải sửa code nhiều.

### Thứ tự triển khai đề xuất
1. Thêm call schema/model.
2. Thêm call service.
3. Nối signaling socket vào realtime.
4. Lưu và cập nhật trạng thái call.
5. Làm flow audio 1-1 ở client.
6. Tái sử dụng cùng flow đó cho video.
7. Render lịch sử cuộc gọi trong màn hình chat.

## Kế hoạch chi tiết: Tạo `call module`

### Mục tiêu của module
- Gom toàn bộ logic liên quan đến cuộc gọi vào một chỗ.
- Giữ `messages` chỉ cho chat text/media.
- Cho phép lưu lịch sử call rõ ràng, dễ đọc, dễ mở rộng.
- Làm nền cho `1-1 audio` và `1-1 video` sau này.

### Những phần sẽ có trong module
1. `call.module.ts`
   - Đăng ký module.
   - Import các module cần dùng như `UsersModule`, `ConversationsModule`, `RelationshipsModule`, `RealtimeModule` nếu cần.

2. `call.schema.ts`
   - Lưu dữ liệu cuộc gọi.
   - Các field chính:
     - `callerId`
     - `calleeId`
     - `conversationId`
     - `callType`
     - `status`
     - `startedAt`
     - `endedAt`
     - `duration`
     - `createdAt`
     - `updatedAt`

3. `call.service.ts`
   - Xử lý logic chính của call.
   - Tạo call record.
   - Update trạng thái call.
   - Chốt duration.
   - Kiểm tra quyền gọi.

4. `call-query.service.ts`
   - Đọc lịch sử call.
   - Lấy call theo conversation.
   - Phân trang nếu cần.

5. `dto/`
   - Chuẩn hoá input cho các thao tác call.
   - Ví dụ:
     - `start-call.dto.ts`
     - `accept-call.dto.ts`
     - `reject-call.dto.ts`
     - `end-call.dto.ts`

6. `types/`
   - Định nghĩa kiểu dữ liệu rõ ràng.
   - Ví dụ:
     - `call-type.ts`
     - `call-status.ts`

7. `constants/`
   - Chứa status, type, message cố định.
   - Giúp code đồng nhất và dễ bảo trì.

8. `call.controller.ts` nếu cần HTTP
   - Chỉ dùng cho việc đọc lịch sử call.
   - Không dùng cho signaling realtime.

### Trách nhiệm của module
- Không truyền audio/video.
- Không xử lý WebRTC media.
- Chỉ quản lý:
  - create call
  - accept/reject
  - end call
  - lưu trạng thái
  - trả lịch sử call

### Các trạng thái nên có
- `calling`
- `accepted`
- `rejected`
- `ended`
- `missed`
- `failed`

### Các rule phải check trong module
- User có tồn tại không.
- User có bị disabled không.
- User có bị ban không.
- Hai user có block nhau không.
- User có được phép gọi trong conversation đó không.

### Luồng xử lý chính
1. User bấm nút call trên client.
2. Client phát socket `call:start`.
3. Gateway nhận event và gọi `CallService`.
4. `CallService` kiểm tra quyền và tạo record.
5. Server báo sang người nhận qua socket.
6. Người nhận accept hoặc reject.
7. Server cập nhật trạng thái call.
8. Hai client trao đổi `offer/answer/ice-candidate` qua socket.
9. Khi kết thúc, server chốt `endedAt` và `duration`.

### Thứ tự code trong module
1. Tạo schema trước.
2. Tạo service xử lý create/update.
3. Tạo query service nếu cần đọc lịch sử.
4. Nối module vào `realtime`.
5. Thêm socket events.
6. Thêm API đọc lịch sử nếu cần.

### Những gì chưa làm ở giai đoạn đầu
- Không làm group call.
- Không làm SFU.
- Không làm TURN ngay từ đầu.
- Không đụng vào logic message hiện tại.
- Không gộp call vào message.
