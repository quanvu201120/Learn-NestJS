# Plan học Realtime Chat với NestJS

## 1) Mục tiêu
- Xây dựng được một chat realtime cơ bản bằng NestJS + Socket.IO + MongoDB.
- Xác thực người dùng bằng JWT khi mở kết nối WebSocket.
- Lưu tin nhắn vào database và phát realtime cho các thành viên trong phòng.
- Mở rộng được lên nhiều instance bằng Redis Adapter khi cần scale.

## 2) Kiến trúc tổng quan

```mermaid
graph TD
    Client[Socket.IO Client / Frontend] <-->|WebSocket| Gateway[NestJS Chat Gateway]
    Gateway <-->|Verify JWT| AuthService[Auth Service]
    Gateway <-->|Save history| MongoDB[(MongoDB / Mongoose)]
    Gateway <-->|Sync events| Redis[(Redis Pub/Sub)]
```

## 3) Kiến thức cần nắm theo thứ tự

### Bước 1: WebSocket và NestJS Gateway
- Hiểu khác biệt giữa HTTP request/response và kết nối WebSocket 2 chiều.
- Nắm cách NestJS tổ chức realtime qua `@nestjs/websockets`.
- Chọn Socket.IO để có sẵn reconnect, rooms, namespaces, ack event.

```bash
npm i @nestjs/websockets @nestjs/platform-socket.io socket.io socket.io-client
```

### Bước 2: Thiết kế dữ liệu chat
Tối thiểu nên có 2 collection:

#### `conversations`
- `name`: tên phòng, dùng cho group chat.
- `isGroup`: phân biệt chat 1-1 hay chat nhóm.
- `users`: danh sách `ObjectId` của thành viên.
- `lastMessage`: tham chiếu tin nhắn gần nhất để render danh sách chat.

#### `messages`
- `conversation`: phòng chat chứa tin nhắn.
- `sender`: người gửi.
- `content`: nội dung text hoặc link media.
- `readBy`: danh sách user đã đọc.

#### Việc cần làm ở bước này
- Tạo `conversation.schema.ts` và `message.schema.ts`.
- Tạo `chat.module.ts` hoặc `conversations.module.ts` nếu muốn tách module rõ ràng.
- Tạo service để xử lý dữ liệu chat, chưa cần làm full CRUD máy móc.
- Tạo các REST API tối thiểu để frontend có dữ liệu nền trước khi nối realtime.

#### API tối thiểu nên có
- `POST /conversations`: tạo cuộc trò chuyện mới.
- `GET /conversations`: lấy danh sách cuộc trò chuyện của user hiện tại.
- `GET /conversations/:id`: lấy thông tin một cuộc trò chuyện.
- `GET /conversations/:id/messages`: lấy lịch sử tin nhắn theo phòng, có phân trang nếu được.

#### Chưa cần làm ngay
- Chưa cần `PUT /messages/:id` hoặc `DELETE /messages/:id`.
- Chưa cần gen full resource cho `Message`.
- Chưa cần làm edit message, recall message, delete for everyone ở giai đoạn đầu.

#### Kết quả mong đợi của bước này
- MongoDB lưu được conversation và message đúng quan hệ.
- Có API để frontend render danh sách chat và lịch sử chat.
- Có chỗ service sẵn để Gateway gọi khi nhận event `send_message`.

### Bước 3: Xác thực JWT trong WebSocket
- Client gửi token khi khởi tạo socket, ví dụ `io(url, { auth: { token } })`.
- Ở server, lấy token từ `client.handshake.auth.token`.
- Verify token bằng `AuthService` hoặc `JwtService`.
- Nếu hợp lệ, gắn user vào `client.data.user`.
- Nếu không hợp lệ, ngắt kết nối.

### Bước 4: Rooms và luồng tin nhắn
- Mỗi user join vào room riêng bằng chính `userId` để nhận thông báo cá nhân.
- Khi mở một cuộc trò chuyện, client gửi event `join_room`.
- Gateway cho socket join room `conversationId`.
- Khi gửi tin nhắn:
  - client emit `send_message`
  - gateway kiểm tra quyền truy cập phòng
  - lưu message vào MongoDB
  - broadcast qua room bằng `this.server.to(conversationId).emit(...)`

### Bước 5: Online, typing, read status
- Online/offline: theo dõi socket đang active theo `userId`.
- Typing indicator: phát event ngắn hạn trong room.
- Read status: cập nhật `readBy` hoặc một bảng trạng thái riêng nếu cần tối ưu.

### Bước 6: Redis Adapter khi scale
- Khi app chạy nhiều instance, Socket.IO cần Redis để sync event giữa các server.
- Dùng `@socket.io/redis-adapter`.
- Mục tiêu là user ở server A vẫn nhận được message từ user ở server B.

## 4) Lộ trình thực hành

### Tuần 1: Kết nối realtime cơ bản
- Tạo `chat.module.ts` và `chat.gateway.ts`.
- Bắt event connect/disconnect.
- Verify JWT ở lúc connect.
- Làm một file client test đơn giản để gửi/nhận event.

**Kết quả mong đợi**
- Kết nối socket thành công.
- Biết được user nào đang online.
- Có thể join room cá nhân.

### Tuần 2: Dữ liệu và API nền
- Tạo schema `Conversation` và `Message`.
- Viết REST API để:
  - tạo cuộc trò chuyện
  - lấy danh sách cuộc trò chuyện
  - lấy lịch sử tin nhắn
- Kiểm tra quyền truy cập conversation trước khi trả dữ liệu.

**Kết quả mong đợi**
- Có thể tạo và đọc dữ liệu chat từ MongoDB.
- Có API đủ dùng để frontend hiển thị danh sách và lịch sử chat.

### Tuần 3: Realtime message flow
- Hoàn thiện event `join_room` và `send_message`.
- Lưu message rồi broadcast cho đúng room.
- Thêm typing indicator.
- Thêm online/offline state.

**Kết quả mong đợi**
- Gửi tin nhắn realtime được end-to-end.
- Người trong cùng phòng nhận message ngay lập tức.

### Tuần 4: Tối ưu và mở rộng
- Tích hợp Redis Adapter cho Socket.IO.
- Kiểm tra chạy nhiều instance.
- Bổ sung test cơ bản cho gateway / luồng realtime nếu có thể.

**Kết quả mong đợi**
- Realtime chạy ổn khi scale.
- Kiến trúc đủ sạch để mở rộng thêm notification, read receipt, file upload.

## 5) Checklist hoàn thành
- [ ] Kết nối Socket.IO thành công
- [ ] Verify JWT khi connect
- [ ] Join room cá nhân
- [ ] Join room conversation
- [ ] Gửi và nhận message realtime
- [ ] Lưu message vào MongoDB
- [ ] Có API lấy lịch sử chat
- [ ] Có online/offline status
- [ ] Có typing indicator
- [ ] Tích hợp Redis Adapter

## 6) Gợi ý cách bắt đầu
- Bắt đầu từ Gateway + auth socket trước.
- Sau đó làm schema và API để có data thật.
- Cuối cùng mới thêm typing, read status và Redis.
