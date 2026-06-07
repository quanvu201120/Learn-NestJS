Mình sẽ chỉ theo đúng kiểu: "đặt file ở đâu, file đó để làm gì, thư viện nào làm gì, hàm nào làm gì", để bạn đi từ số 0 vẫn ráp được.

## Mục tiêu

Ta đang có backend NestJS với auth JWT và conversation/message REST rồi. Phần realtime chỉ là thêm một "cửa riêng" để client giữ kết nối mở với server và gửi/nhận event ngay lập tức, thay vì mỗi lần đều gọi HTTP.

Trong project này, cách dễ học nhất là dùng:

- `@nestjs/websockets`: cho NestJS viết gateway realtime
- `@nestjs/platform-socket.io`: adapter để Nest chạy với Socket.IO
- `socket.io`: server realtime
- `socket.io-client`: client realtime cho React test

## Realtime là gì trong project này

REST hiện tại dùng để:

- login
- lấy danh sách conversation
- lấy lịch sử message ban đầu

Socket realtime sẽ dùng để:

- connect bằng JWT
- join vào room của conversation
- gửi message mới
- nhận message mới ngay
- typing
- read status

Nói ngắn gọn:

- REST = lấy dữ liệu nền
- Socket = cập nhật ngay lập tức

## Nên đặt file ở đâu

Với cấu trúc hiện tại, mình khuyên đặt realtime thành 1 module riêng để dễ hiểu:

```text
src/
  realtime/
    realtime.module.ts
    chat.gateway.ts
    dto/
      join-room.dto.ts
      send-message.dto.ts
      mark-read.dto.ts
      typing.dto.ts
    interfaces/
      socket-user.interface.ts
```

Và nhớ import `RealtimeModule` vào `src/app.module.ts`.

Tại sao tách riêng:

- `auth/` đang lo xác thực HTTP
- `messages/` đang lo logic message
- `conversations/` đang lo logic conversation
- `realtime/` chỉ lo socket event

Cách tách này giúp bạn không bị rối.

## Vai trò từng file

### `chat.gateway.ts`

Đây là file quan trọng nhất của realtime.

- Nó giống như controller nhưng cho socket
- Chứa:
  - xử lý khi client connect
  - xử lý khi client disconnect
  - xử lý event `join_room`
  - xử lý event `send_message`
  - xử lý event `mark_read`
  - xử lý event `typing_start`, `typing_stop`

### `realtime.module.ts`

Khai báo gateway và inject các service cần dùng.

Thường import:

- `AuthModule`
- `ConversationsModule`
- `MessagesModule`

### `dto/join-room.dto.ts`

Mô tả payload client gửi khi muốn join room.

Ví dụ chỉ cần:

- `conversationId`

### `dto/send-message.dto.ts`

Mô tả payload gửi tin nhắn.

Ví dụ:

- `conversationId`
- `content`
- `type`
- `replyTo`

### `dto/mark-read.dto.ts`

Payload khi đánh dấu đã đọc.

Ví dụ:

- `conversationId`
- `messageId`

### `dto/typing.dto.ts`

Payload typing.

Thường chỉ cần:

- `conversationId`

### `interfaces/socket-user.interface.ts`

Mô tả dữ liệu user sau khi verify JWT.

Dùng để gán vào `client.data.user`.

## Thư viện nào dùng để làm gì

### `@nestjs/websockets`

Cung cấp decorator như:

- `@WebSocketGateway()`
- `@SubscribeMessage()`
- `@ConnectedSocket()`
- `@MessageBody()`

Nói dễ hiểu: giúp viết socket theo style NestJS.

### `@nestjs/platform-socket.io`

Cho NestJS dùng Socket.IO làm engine realtime.

Nếu không có nó thì gateway không hoạt động đúng với Socket.IO.

### `socket.io`

Thư viện server realtime.

Hỗ trợ:

- rooms
- reconnect
- ack callback
- custom events

### `socket.io-client`

Client phía React.

Dùng để connect tới gateway NestJS.

### `@nestjs/jwt`

Dùng verify access token trong lúc socket connect.

## Các khái niệm cần hiểu trước khi code

### `connection`

Khi client mở socket tới server.

Tương đương "đăng nhập vào kênh realtime".

### `event`

Tên hành động gửi qua socket.

Ví dụ:

- `join_room`
- `send_message`

### `emit`

Gửi event.

### `on`

Lắng nghe event.

### `room`

Một nhóm socket.

Ở đây mỗi conversation sẽ là một room.

### `ack`

Callback trả kết quả ngay cho bên gửi event.

Rất hợp để debug.

Ví dụ:

- client emit `join_room`
- server xử lý xong
- server gọi callback trả `{ ok: true }`

## Flow tổng thể sẽ chạy như nào

1. User login bằng REST `POST /auth/login`
2. Lấy `accessToken`
3. React client connect socket với token đó
4. Server verify token trong `handleConnection`
5. Nếu hợp lệ:
   - gắn user vào `client.data.user`
   - cho socket join room riêng theo `userId`
6. Khi user mở conversation:
   - client emit `join_room`
   - server check user có thuộc conversation không
   - nếu đúng thì join room `conversationId`
7. Khi user gửi tin:
   - client emit `send_message`
   - server lưu DB bằng `MessagesService`
   - server emit `message_created` cho room conversation
8. Các user trong room nhận message ngay

## File quan trọng nhất: `chat.gateway.ts`

Bạn cứ hiểu file này có 3 nhóm hàm:

### Hàm vòng đời kết nối

- `handleConnection`
- `handleDisconnect`

### Hàm xử lý event

- `handleJoinRoom`
- `handleSendMessage`
- `handleMarkRead`
- `handleTypingStart`
- `handleTypingStop`

### Hàm helper nội bộ

- `extractToken`
- `verifySocketUser`
- `getCurrentUser`
- `ensureConversationMember`

## Từng hàm có tác dụng gì

### 1. `handleConnection(client)`

Chạy khi client vừa connect socket.

Nhiệm vụ:

- lấy token từ `client.handshake.auth.token`
- verify token
- lấy payload user
- gán vào `client.data.user`
- join room riêng theo `userId`

Tại sao join room riêng theo `userId`?

- Sau này muốn gửi thông báo cá nhân thì chỉ cần emit vào room user đó

Ví dụ tác dụng:

- user A có 2 tab
- cả 2 tab đều join room `userId = A`
- server emit vào room A thì cả 2 tab cùng nhận

### 2. `handleDisconnect(client)`

Chạy khi socket ngắt kết nối.

Nhiệm vụ giai đoạn đầu:

- log ai vừa disconnect
- sau này có thể dùng để update online/offline

### 3. `handleJoinRoom(body, client)`

Chạy khi client gửi event `join_room`.

Payload:

- `conversationId`

Nhiệm vụ:

- lấy user hiện tại từ `client.data.user`
- check user có thuộc conversation không
- nếu có thì `client.join(conversationId)`
- trả ack thành công

Tại sao phải check?

- Nếu không check, ai biết `conversationId` cũng join lén được

### 4. `handleSendMessage(body, client)`

Chạy khi client gửi event `send_message`.

Payload:

- `conversationId`
- `content`
- `type`
- `replyTo` nếu có

Nhiệm vụ:

- check user có quyền trong conversation
- gọi `messagesService.createMessage(...)`
- lưu DB
- emit `message_created` tới room conversationId
- ack lại message vừa tạo cho sender

Đây là hàm quan trọng nhất vì nó nối:

- socket input
- business logic
- database
- realtime output

### 5. `handleMarkRead(body, client)`

Payload:

- `conversationId`
- `messageId`

Nhiệm vụ:

- check membership
- gọi `conversationsService.markAsRead(...)`
- emit `conversation_read` hoặc `message_read`

### 6. `handleTypingStart(body, client)`

Payload:

- `conversationId`

Nhiệm vụ:

- check membership
- broadcast sang room rằng user đang gõ
- không lưu DB

### 7. `handleTypingStop(body, client)`

Giống `typing_start`, chỉ khác là báo đã ngừng gõ.

## Nên import service nào vào gateway

Trong gateway bạn sẽ cần:

- `JwtService` hoặc `AuthService`
- `ConversationsService`
- `MessagesService`
- `ConfigService` nếu secret JWT cần đọc từ env

Nếu mục tiêu là nhanh và rõ, mình khuyên verify trực tiếp bằng `JwtService`.

Vì ở socket connect bạn chỉ cần:

- token có hợp lệ không
- payload là ai

## DTO nên có gì

Ví dụ tối thiểu:

### `join-room.dto.ts`

- `conversationId: string`

### `send-message.dto.ts`

- `conversationId: string`
- `content: string`
- `type: string`
- `replyTo?: string`

### `mark-read.dto.ts`

- `conversationId: string`
- `messageId: string`

### `typing.dto.ts`

- `conversationId: string`

Tác dụng DTO:

- định nghĩa rõ client phải gửi gì
- validate dễ hơn
- code gateway dễ đọc hơn

## Tên event nên chốt ngay

Client gửi lên server:

- `join_room`
- `send_message`
- `mark_read`
- `typing_start`
- `typing_stop`

Server phát xuống client:

- `message_created`
- `conversation_read`
- `typing_started`
- `typing_stopped`

Lợi ích:

- FE test dễ
- sau này không bị loạn tên event

## Realtime module nên làm gì

`realtime.module.ts` chỉ là nơi "nối dây".

Nhiệm vụ:

- đăng ký `ChatGateway`
- import module mà gateway cần

Ví dụ tư duy:

- gateway muốn gọi `MessagesService`
- vậy module realtime phải import `MessagesModule`

## Client React test nên đặt ở đâu

Mình khuyên tạo riêng ở root:

```text
realtime-client/
  src/
    App.tsx
    main.tsx
```

Không nên nhét vào `src/` của NestJS vì:

- backend và frontend khác runtime
- dễ học hơn khi tách rõ

## Client React test cần những gì

Một trang duy nhất là đủ, gồm:

- ô nhập `baseUrl`
- ô nhập `accessToken`
- ô nhập `conversationId`
- nút `Connect`
- nút `Join room`
- ô nhập `message`
- nút `Send`
- vùng log event

Tác dụng:

- giúp bạn nhìn được rõ từng bước
- lỗi ở đâu thấy ngay

## Cách client connect

Client dùng `socket.io-client`.

Ý nghĩa đoạn connect:

- `io(url, { auth: { token } })`
- token được gửi trong handshake
- server đọc ở `client.handshake.auth.token`

Đây là điểm nối giữa Postman JWT và Socket.IO.

## Tại sao chưa cần Next

Vì bạn đang học realtime nền tảng:

- cách connect
- cách join room
- cách gửi event
- cách nhận event

`Next` không giúp phần này dễ hơn. Nó chỉ thêm nhiều thứ mới phải học cùng lúc.

## Lộ trình học thực chiến cho bạn

### Ngày 1

- hiểu gateway là gì
- tạo `realtime/`
- viết `handleConnection`
- connect client bằng JWT

### Ngày 2

- viết `join_room`
- test join thành công/thất bại

### Ngày 3

- viết `send_message`
- test lưu DB + broadcast realtime

### Ngày 4

- viết `typing`
- viết `mark_read`

Đi như vậy sẽ đỡ ngợp hơn nhiều.

## Nếu bắt đầu code ngay thì làm theo checklist này

1. Tạo thư mục:

```text
src/realtime/
src/realtime/dto/
src/realtime/interfaces/
```

2. Tạo file:

```text
src/realtime/realtime.module.ts
src/realtime/chat.gateway.ts
src/realtime/dto/join-room.dto.ts
src/realtime/dto/send-message.dto.ts
src/realtime/dto/mark-read.dto.ts
src/realtime/dto/typing.dto.ts
src/realtime/interfaces/socket-user.interface.ts
```

3. Import `RealtimeModule` vào `src/app.module.ts`
4. Làm `handleConnection`
5. Làm `join_room`
6. Làm `send_message`
7. Tạo `realtime-client/` bằng Vite React
8. Test bằng token copy từ `POST /auth/login`

## Chỗ nào trong code hiện tại sẽ được tái sử dụng

Từ plan và file bạn đang mở:

- `src/modules/conversations/conversations.service.ts`: dùng để check conversation, member, mark read
- `MessagesService`: dùng để tạo message và lấy message
- `src/auth/auth.controller.ts`: nơi lấy `accessToken`
- `src/app.module.ts`: nơi gắn module realtime vào app

## Chốt ngắn gọn

Bạn chưa cần nghĩ "làm app chat hoàn chỉnh". Chỉ cần hiểu 3 khối:

- `Gateway`: cửa vào realtime
- `Room`: nhóm người nhận event
- `Event`: hành động gửi/nhận

Nếu muốn, bước tiếp theo mình có thể làm đúng kiểu cầm tay chỉ việc cho bạn:

1. Vẽ ra nội dung cụ thể của từng file trong `src/realtime/`
2. Giải thích từng decorator trong `chat.gateway.ts`
3. Sau đó scaffold luôn code khung cho bạn ngay trong project này
