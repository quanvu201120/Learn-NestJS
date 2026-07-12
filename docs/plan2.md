## Plan: Block trong group theo hướng backend-only

### Mục tiêu

- Giữ nguyên logic `block` trên toàn bộ conversation.
- Nếu `A` block `B` hoặc `B` block `A` thì trong group:
    - không thấy nội dung tin nhắn của nhau
    - không được reply tin nhắn của nhau
    - không được reaction vào tin nhắn của nhau
    - không nhận realtime event của nhau
    - `lastMessage` không lộ nội dung của người bị block
- FE không phải tự xử lý thêm logic block riêng cho group.

### Ý tưởng chính

- Backend sẽ lọc dữ liệu từ DB theo `currentUserId` trước khi serialize response.
- Mỗi conversation cần được xem theo góc nhìn của từng user.
- Các user không hợp lệ với viewer hiện tại sẽ được đổi sang nội dung trung tính như:
    - `Người dùng bị ẩn`
    - `Tin nhắn bị ẩn`
- FE chỉ render dữ liệu đã được backend chuẩn hóa.

### Phạm vi ảnh hưởng

#### 1. Conversation serialize

- `serializeConversation()` cần biết `currentUserId`.
- Khi serialize group conversation:
    - lọc member không hợp lệ với viewer
    - ẩn thông tin user bị block nếu cần
    - giữ `lastMessageId` global như hiện tại, nhưng serialize nội dung theo viewer

#### 2. Message list

- `getMessagesByConversation()` phải lọc message trong DB trước khi serialize.
- Message của user bị block với viewer hiện tại không được trả về nội dung thật.
- Nếu cần giữ vị trí message để UI không bị trống kỳ lạ, có thể serialize thành:
    - user name: `Người dùng bị ẩn`
    - content: `Tin nhắn bị ẩn`
    - sender info: tối giản, không lộ profile thật

#### 3. Latest message / sidebar preview

- `getLatestMessageByConversation()` và các response conversation list/detail vẫn dùng `lastMessageId` như hiện tại.
- Backend không đổi sang `last visible message`.
- Nếu `lastMessage` thuộc về user bị block:
    - backend serialize sender thành `Người dùng bị ẩn`
    - backend serialize content thành `Tin nhắn bị ẩn`
    - backend có thể thêm flag nhận diện nội dung bị ẩn nếu cần
- FE không tự if theo relationship raw nào cả; FE chỉ render theo response đã được chuẩn hóa.

#### 4. Realtime socket

- Các event realtime phải được filter theo viewer trước khi emit:
    - `chat:new-message`
    - `message:updated`
    - `chat:message-deleted`
    - `user:typing-update`
    - `user:unseen-message`
    - reaction event nếu có
- Người bị block không được nhận event liên quan đến người block mình.

#### 5. Mark read

- `mark-read` giữ nguyên như hiện tại.
- Vẫn đánh dấu theo `messageId` của message mới nhất mà user đang mở.
- Không cần thêm logic riêng cho block ở bước này.
- Nếu user có thể nhìn thấy message nào đó ở UI thì cho phép mark read message đó bình thường; việc message có bị ẩn ở các phần khác hay không sẽ do lớp serialize xử lý.

#### 6. Message actions

- Reply vào message của user bị block phải bị chặn.
- Reaction vào message của user bị block phải bị chặn.
- Update/delete các message cũ vẫn cần kiểm tra visibility để không lộ data qua payload trả về.

### Dữ liệu cần xác định

- Với mỗi request/socket context cần có:
    - `currentUserId`
    - `conversationId`
    - danh sách member của conversation
- Từ đó backend tạo ra:
    - `invalidUserIds`
    - `visibleUserIds`
    - `visibleMessages`
    - `hiddenMessagePayload`

### Hướng triển khai

#### Phase 1: Tạo helper lọc visibility

- Thêm helper trong service phù hợp để lấy danh sách user bị block giữa viewer và members của conversation.
- Helper này phải trả về danh sách ID không hợp lệ để dùng lại ở nhiều nơi.
- Mục tiêu là tránh viết lại query block ở nhiều service khác nhau.

#### Phase 2: Lọc dữ liệu conversation

- Sửa các luồng serialize conversation list/detail.
- Ẩn hoặc chuẩn hóa member bị block thành `Người dùng bị ẩn`.
- Đảm bảo FE nhận response đã an toàn, không cần tự map block state.

#### Phase 3: Lọc message history

- Sửa `getMessagesByConversation()`.
- Với mỗi message:
    - nếu sender hợp lệ thì serialize bình thường
    - nếu sender không hợp lệ thì serialize nội dung trung tính như đã bàn ở trên

#### Phase 4: Xử lý `lastMessage`

- Giữ `lastMessageId` trong DB như hiện tại.
- Chỉ serialize `lastMessage` theo viewer:
    - nếu sender hợp lệ thì trả nội dung đầy đủ như bình thường
    - nếu sender không hợp lệ thì đổi sang nội dung trung tính

#### Phase 5: Filter realtime

- Tại gateway, trước khi emit từng event:
    - xác định viewer có được phép thấy message/user đó không
    - nếu không hợp lệ thì bỏ qua emit cho viewer đó
- Không dùng broadcast mù cho toàn room với message/user bị block.

#### Phase 6: Kiểm tra các luồng phụ

- Review:
    - reaction
    - typing
    - unseen count
    - deleted/updated message payload
- Bất kỳ payload nào chứa sender/message của user bị block đều phải đi qua cùng rule lọc.

### Nguyên tắc serialize

- Không để FE phải tự suy luận relationship block.
- Backend phải trả ra dữ liệu đã được chuẩn hóa theo viewer.
- Nếu user không hợp lệ:
    - không lộ tên thật
    - không lộ avatar thật
    - không lộ content thật
    - không lộ action realtime của họ
    - nhưng response vẫn giữ cùng shape để FE không phải đổi flow

### Rủi ro cần chú ý

- `lastMessage` vẫn là phần cần cẩn thận vì DB chỉ có 1 giá trị global nhưng UI cần theo từng user.
- Nếu chỉ sửa API mà không sửa socket, dữ liệu sẽ lệch.
- Nếu chỉ ẩn message mà không ẩn reaction/typing/seen, policy sẽ bị hở.
- Cần giữ response shape ổn định tối đa để không phá FE hiện tại.
