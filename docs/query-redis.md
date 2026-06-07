# Redis Cơ Bản Cho Project Chat Realtime

File này dành cho người mới. Mục tiêu là giúp bạn hiểu:

- Redis là gì trong project này
- Dùng method nào cho bài toán nào
- Flow từ `send_message` đến `emit`
- Khi nào dùng `get/set/del`
- Khi nào dùng `set`, `sadd`, `srem`, `smembers`, `sismember`, `exists`, `expire`, `setex`, `pipeline`

## 1. Redis trong project này dùng để làm gì

Trong project chat realtime, Redis rất hợp cho 2 bài toán:

### A. Online / offline

Ví dụ:

- user A đang online
- user B đang offline

Ta không muốn query DB nặng chỉ để biết user có online không. Redis giúp lưu trạng thái này rất nhanh.

### B. Conversation nào có tin nhắn mới chưa xem

Ví dụ:

- user B chưa mở group `conv123`
- group đó vừa có tin mới
- sidebar của B cần tô đậm

Ta không cần unread count ngay. Chỉ cần biết:

- conversation này đã có tin mới chưa xem hay chưa

Redis rất hợp để lưu cờ này.

## 2. Những lệnh Redis bạn cần nhớ

Bạn không cần học hết Redis. Chỉ cần nắm mấy nhóm lệnh này là đủ.

### `SET`

Lưu một giá trị đơn.

```text
SET presence:user:123 online
```

Ý nghĩa:

- key là `presence:user:123`
- value là `online`

### `GET`

Lấy giá trị của một key.

```text
GET presence:user:123
```

### `DEL`

Xóa key.

```text
DEL presence:user:123
```

### `EXPIRE`

Đặt thời gian sống cho key.

```text
EXPIRE presence:user:123 60
```

Ý nghĩa:

- nếu sau 60 giây không được gia hạn thì key tự mất

### `SETEX`

Vừa set vừa gắn TTL trong một lệnh.

```text
SETEX presence:user:123 60 online
```

Ý nghĩa:

- lưu `presence:user:123 = online`
- key sống 60 giây

### `EXISTS`

Kiểm tra key có tồn tại không.

```text
EXISTS presence:user:123
```

Kết quả:

- `1`: key có tồn tại
- `0`: key không tồn tại

Trong bài toán online/offline:

- có key = online
- không có key = offline

### `SADD`

Thêm phần tử vào một `Set`.

```text
SADD unseen:conversations:123 convA
```

Ý nghĩa:

- thêm `convA` vào tập các conversation chưa xem của user `123`

Kết quả trả về:

- `1`: phần tử được thêm mới
- `0`: phần tử đã có từ trước

Đây là lệnh cực quan trọng cho sidebar.

### `SREM`

Xóa phần tử khỏi `Set`.

```text
SREM unseen:conversations:123 convA
```

Ý nghĩa:

- user `123` đã mở `convA`
- conversation này không còn là "chưa xem" nữa

### `SMEMBERS`

Lấy toàn bộ phần tử trong `Set`.

```text
SMEMBERS unseen:conversations:123
```

Ví dụ trả về:

```text
[convA, convB, convC]
```

### `SISMEMBER`

Kiểm tra 1 phần tử có nằm trong `Set` không.

```text
SISMEMBER unseen:conversations:123 convA
```

Kết quả:

- `1`: có
- `0`: không có

### `pipeline`

`pipeline` không phải là lệnh Redis đơn lẻ. Đây là cách:

- gom nhiều lệnh Redis lại
- gửi một lần
- lấy kết quả một lần

Rất hợp khi bạn có một mảng `userIds` lớn.

## 3. Bài toán online / offline nên dùng lệnh nào

Với nhu cầu hiện tại của bạn: chỉ cần biết user online hay offline, cách đơn giản nhất là:

- key: `presence:user:{userId}`
- value: `online`
- TTL: `60s`

### Khi socket connect

Set key:

```text
SETEX presence:user:123 60 online
```

### Khi client gửi heartbeat

Gia hạn key:

```text
EXPIRE presence:user:123 60
```

Hoặc set lại:

```text
SETEX presence:user:123 60 online
```

### Khi check user online không

```text
EXISTS presence:user:123
```

Nếu:

- `1` => online
- `0` => offline

### Khi logout

```text
DEL presence:user:123
```

## 4. Bài toán sidebar "có tin nhắn mới" nên dùng gì

Bạn không cần unread count ngay. Bạn chỉ cần biết:

- conversation này đã có tin mới chưa xem hay chưa

Cách đẹp nhất là:

- mỗi user có một `Set`
- Set này chứa các `conversationId` đang có tin mới chưa xem

### Redis key

```text
unseen:conversations:{userId}
```

Ví dụ:

```text
unseen:conversations:123
```

### Bên trong Set có gì

Ví dụ:

```text
unseen:conversations:123 = { convA, convB }
```

Ý nghĩa:

- user `123` đang có tin mới chưa xem ở `convA` và `convB`

## 5. Flow từ lúc `createMessage` đến lúc `emit`

Đây là phần quan trọng nhất.

### Giả sử

- A gửi message vào group `convG`
- thành viên group là `A, B, C, D`
- A là người gửi

### Bước 1: server tạo message trong DB

Server gọi:

- `messagesService.createMessage(...)`

Kết quả:

- tạo message thành công

### Bước 2: emit cho người đang mở room chat

Server emit:

```ts
this.server.to(conversationId).emit('message_created', message);
```

Ý nghĩa:

- ai đang mở `convG`
- đã `join(convG)`
- sẽ thấy message realtime

### Bước 3: lấy danh sách member

Từ DB lấy:

```ts
memberIds = [A, B, C, D];
```

### Bước 4: bỏ người gửi

```ts
memberIdsWithoutSender = [B, C, D];
```

### Bước 5: lọc người online

Ví dụ chỉ có:

```ts
onlineUserIds = [B, D];
```

### Bước 6: với từng user online, thử `SADD`

Ví dụ với `B`:

```text
SADD unseen:conversations:B convG
```

Nếu trả `1`:

- nghĩa là `convG` trước đó chưa có trong unseen set của B
- bây giờ mới được thêm lần đầu
- phải emit event nhẹ cho B

Nếu trả `0`:

- nghĩa là B đã có cờ chưa xem với `convG` rồi
- không cần emit nữa

### Bước 7: emit event nhẹ cho sidebar

Chỉ emit nếu `SADD == 1`:

```ts
this.server.to(userId).emit('conversation_dirty', {
    conversationId,
});
```

Payload chỉ cần:

```ts
{
    conversationId: 'convG',
}
```

### Bước 8: khi user mở conversation đó

Ví dụ B click vào `convG`, thì clear cờ:

```text
SREM unseen:conversations:B convG
```

Ý nghĩa:

- B đã xem group đó rồi
- lần sau có message mới thì `SADD` sẽ lại trả `1`

## 6. Tại sao `SADD` lại rất hợp bài toán này

Vì `SADD` tự trả lời câu hỏi:

- conversation này với user này đã được đánh dấu "chưa xem" chưa?

Bạn không cần:

- `EXISTS`
- rồi `GET`
- rồi `SET`

Chỉ cần:

```text
SADD unseen:conversations:{userId} {conversationId}
```

Kết quả:

- `1` => vừa chuyển từ `clean -> dirty`
- `0` => đã dirty rồi

Đây chính là lý do tin nhắn thứ 2, 3, 4 không phải emit lại cho cùng user đó.

## 7. Có cần check key set tồn tại trước không

Không cần.

Ví dụ:

```text
SADD unseen:conversations:123 convA
```

Nếu key `unseen:conversations:123` chưa tồn tại:

- Redis sẽ tự tạo Set mới

Đây là điểm rất tiện.

## 8. Vấn đề tối ưu: đừng `await` Redis từng vòng

Nếu bạn có 500 user online và code kiểu:

```ts
for (const userId of userIds) {
    const added = await redis.sadd(...);
}
```

thì bị chậm vì:

- query Redis tuần tự
- mỗi vòng chờ xong mới đến vòng sau

### Cách tốt hơn

Dùng `pipeline`.

## 9. `pipeline` dùng như nào

Ví dụ bạn có:

```ts
const onlineUserIds = ['u1', 'u2', 'u3'];
const conversationId = 'conv123';
```

### Tạo pipeline

```ts
const pipeline = redis.pipeline();
```

### Add lệnh vào pipeline

```ts
for (const userId of onlineUserIds) {
    pipeline.sadd(`unseen:conversations:${userId}`, conversationId);
}
```

Lúc này:

- các lệnh được xếp hàng
- chưa gửi ngay

### Chạy pipeline

```ts
const results = await pipeline.exec();
```

### Kết quả

`results` thường có dạng:

```ts
[
    [null, 1],
    [null, 0],
    [null, 1],
]
```

Ý nghĩa:

- user 1: `SADD == 1`
- user 2: `SADD == 0`
- user 3: `SADD == 1`

### Lọc user cần emit

```ts
const usersNeedNotify: string[] = [];

results.forEach((item, index) => {
    const [error, added] = item;
    const userId = onlineUserIds[index];

    if (!error && added === 1) {
        usersNeedNotify.push(userId);
    }
});
```

### Emit sau cùng

```ts
for (const userId of usersNeedNotify) {
    this.server.to(userId).emit('conversation_dirty', {
        conversationId,
    });
}
```

## 10. Tóm tắt Redis method theo bài toán

### Online / offline

- `SETEX`: lưu user online với TTL
- `EXPIRE`: gia hạn TTL
- `EXISTS`: check online không
- `DEL`: xóa key khi logout nếu cần

### Sidebar "có tin mới"

- `SADD`: đánh dấu conversation có tin chưa xem
- `SREM`: clear cờ khi user mở conversation
- `SMEMBERS`: lấy danh sách conversation chưa xem
- `SISMEMBER`: check một conversation có đang unseen không

### Tối ưu nhiều lệnh

- `pipeline`: gom batch Redis commands

## 11. Chốt tư duy

Bạn chỉ cần nhớ 3 ý:

### A. Presence online/offline

```text
presence:user:{userId}
```

TTL 60 giây, heartbeat gia hạn.

### B. Sidebar unseen

```text
unseen:conversations:{userId}
```

Đây là Set chứa các `conversationId` chưa xem.

### C. Khi gửi message

1. tạo message trong DB
2. emit `message_created` vào room conversation
3. với user online khác:
   - `SADD unseen:conversations:{userId} {conversationId}`
   - nếu trả `1` thì emit `conversation_dirty`
   - nếu trả `0` thì bỏ qua

## 12. Bạn nên học thuộc gì trước

Nếu mới học, cứ học thuộc mấy cái này trước là đủ:

- `SETEX`
- `EXPIRE`
- `EXISTS`
- `DEL`
- `SADD`
- `SREM`
- `SMEMBERS`
- `SISMEMBER`
- `pipeline`

Chỉ cần nắm được 9 thứ này là bạn đủ dùng Redis cho phần realtime đầu tiên của project này.
