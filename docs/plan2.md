# Rà soát bảo mật & bug — NestJS Backend

Phạm vi: toàn bộ `src/` (auth, conversations/messages, media, realtime/calls, reports/admin, config/bootstrap). Rà soát chỉ đọc, chưa sửa file nào.

## Ưu tiên xử lý trước (High/Critical)

1. **`create-password` cho phép chiếm quyền tài khoản** — `src/modules/users/user-password.service.ts:60-78`
2. **Reset/đổi mật khẩu không thu hồi session cũ** — `src/modules/users/user-password.service.ts:33-55, 136-160`
3. **IDOR: đọc tin nhắn mới nhất của bất kỳ conversation nào** — `src/modules/messages/messages.controller.ts:168-175`
4. **Media R2 riêng tư lộ qua URL công khai, không cần xác thực** — `src/modules/media/utils/media.serializer.ts:20-28, 49-51`
5. **Đăng xuất không ngắt kết nối WebSocket đang mở** — `src/auth/auth.service.ts:487, 520` (thiếu emit disconnect)
6. **Upload không giới hạn kích thước buffer trong bộ nhớ (DoS)** — `src/modules/messages/messages.controller.ts:49,76,105,137`

## 3. Media / Upload / Storage

### 3.1 HIGH — Media riêng tư trên R2 lộ qua URL công khai, không xác thực, không hết hạn

`src/modules/media/utils/media.serializer.ts:20-28, 49-51`

```ts
export const buildR2MediaUrl = (objectKey: string) =>
    publicBaseUrl ? `${publicBaseUrl}/${objectKey}` : undefined;
```

Endpoint download (`/media/:id/download`) có kiểm tra quyền cẩn thận, nhưng mọi media R2 (video, voice, file trong conversation) cũng được trả kèm URL công khai `R2_PUBLIC_BASE_URL/objectKey` trong response tin nhắn — bất kỳ ai có link đều truy cập được vĩnh viễn, không cần đăng nhập, không hết hạn, không thể thu hồi. Endpoint download có guard thực chất chỉ mang tính hình thức với R2.

**Khắc phục:** chỉ phục vụ media R2 qua endpoint có guard, hoặc dùng URL ký (presigned) có thời hạn ngắn; giữ bucket ở chế độ private.

### 3.3 MEDIUM — Tải file về không dùng streaming, buffer toàn bộ vào bộ nhớ

`src/modules/media/media-download.service.ts:47-57`, `media.controller.ts:29-30`
`transformToByteArray()` → `Buffer.from` → `res.send()` thay vì pipe stream. Kết hợp với upload cho phép tới 50MB và mục 3.2, nhiều request tải file đồng thời có thể khuếch đại tấn công cạn bộ nhớ.

### 3.4 MEDIUM — Content-Type lưu trữ theo khai báo của client, không theo nội dung thực

`src/modules/media/providers/r2.service.ts:77`, `messages.controller.ts:114,146` (`fallbackToMimetype: true`)
Với các file không có magic-byte đặc trưng (`text/plain`, `text/csv`), validation rơi về tin tưởng mimetype do client khai báo. Vì media R2 lộ qua URL công khai (mục 3.1), content-type sai lệch có thể ảnh hưởng cách trình duyệt render. Nên lưu content-type đã phát hiện thực tế (magic byte), thêm header `X-Content-Type-Options: nosniff` và `Content-Disposition: attachment`.

### 3.5 MEDIUM — Endpoint download bỏ qua trạng thái `isDeleted` và chặn (block) người dùng

`src/modules/media/media-download.service.ts:32-61`
Khác với `getMediasByConversation` (đã lọc `isDeleted` và ẩn media từ người bị block), `downloadR2Media` chỉ kiểm tra membership/ownership. Hậu quả: (a) media đã xoá mềm vẫn tải được nếu còn giữ id; (b) user đã block người khác vẫn tải được file người đó từng gửi.

### 3.6 LOW — `assertMediaAccess` không có nhánh mặc định từ chối (fail-open)

`src/modules/media/media-download.service.ts:63-92` — thiếu `throw` cuối cùng nếu `ownerType` không khớp `User`/`Conversation`. Hiện tại chưa khai thác được vì enum giới hạn, nhưng dễ vỡ nếu có thêm ownerType mới sau này.

### 3.7 LOW/INFO — Ảnh bằng chứng report trên Cloudinary dùng URL công khai không ký

`src/modules/media/providers/cloudinary.service.ts:133`, `report-media.service.ts:43` — bằng chứng report (có thể nhạy cảm) lưu ở chế độ public delivery, ai có URL cũng xem được, không hết hạn.

### Đã kiểm tra và an toàn

Không có SSRF (không fetch URL do user cung cấp), không có path traversal (`sanitizeFileName` + folder cố định + prefix `randomUUID`), không hardcode secret.

---

## 4. Realtime / WebSocket / Calls / Presence

### 4.1 HIGH — Đăng xuất (logout/logout-all) không ngắt kết nối WebSocket đang mở

`src/auth/auth.service.ts:487, 520`
Socket xác thực lúc connect vẫn ở nguyên trong các room suốt vòng đời kết nối. Chỉ có `user.banned`/`user.disabled` mới ép ngắt kết nối; logout và logout-all (đổi mật khẩu, mất thiết bị...) thì không. Việc re-validate session (`validateActiveSession`) chỉ chạy khi có **hành động ghi**, không chạy trên luồng nhận broadcast.

**Hậu quả:** Sau khi user đăng xuất (hoặc admin logout-all vì nghi lộ tài khoản), kẻ tấn công giữ socket cũ vẫn tiếp tục nhận toàn bộ tin nhắn real-time và tín hiệu cuộc gọi, miễn là không thực hiện hành động ghi nào. Việc thu hồi session gần như vô hiệu với kết nối đang mở.

### 4.2 MEDIUM — Heartbeat/typing không kiểm tra lại session/ban

`src/modules/realtime/realtime-chat-command.service.ts:104, 119, 162` — `validateUse` chỉ dùng `client.data.user` đã cache, không kiểm tra `isDisabled`, `banUntil`, `tokenVersion`, hay session bị thu hồi. User bị ban/logout vẫn có thể duy trì trạng thái "online" vĩnh viễn và gửi typing-update vào room.

### 4.3 MEDIUM — Endpoint presence cho phép dò trạng thái online tuỳ ý + DoS mảng không giới hạn

`src/modules/presence/presence.controller.ts:11`, `dto/presence.dto.ts:3`
`GetUserOnlineBodyDto.userIds` có `@ArrayMinSize(1)` nhưng thiếu `@ArrayMaxSize`, không giới hạn phạm vi bạn bè/conversation. User bất kỳ có thể dò trạng thái online của user bất kỳ khác; mảng lớn khiến Redis `MGET` không giới hạn → rủi ro DoS.

### 4.4 MEDIUM/LOW — Không có rate limit trên hầu hết sự kiện socket

Chỉ `call:start` có giới hạn (5 lần/60s). `chat:create-message`, typing, `chat:mark-read`, `chat:join-conversation`, tín hiệu WebRTC không bị giới hạn — một socket đã xác thực có thể spam tạo tin nhắn/broadcast không giới hạn.

### 4.5 LOW — Một số payload socket dùng type inline, không qua DTO validate

`chat.gateway.ts:236` (`handleJoinConversation`), `:365` (`handleDeleteMessage`) — không có class DTO nên `ValidationPipe` không áp dụng được. Rủi ro thấp vì có kiểm tra nghiệp vụ ở tầng dưới, nhưng không nhất quán với các handler khác.

### 4.6 LOW — Race điều kiện khi kết thúc cuộc gọi với nhiều tab

`realtime-call.service.ts:81`, `chat.gateway.ts:162-181` — `activeCallId` gắn theo socket; disconnect ở tab phụ có thể làm sập cuộc gọi dù user vẫn còn kết nối ở tab khác.

### 4.7 LOW — Endpoint lấy cấu hình ICE/TURN không cache, gọi API bên ngoài mỗi lần

`webrtc-config.service.ts:26` — mỗi request đều gọi Metered API, tốn quota/chi phí. Cần xác nhận credential trả về là ngắn hạn (ephemeral), không phải static.

### Đã kiểm tra và an toàn

Xác thực lúc connect (`handleConnection`) kiểm tra đầy đủ JWT/ban/disabled/tokenVersion/session. Không phát hiện giả mạo người gửi (sender identity luôn lấy từ server). Luồng WebRTC signaling được bảo vệ đúng bằng kiểm tra thành viên cuộc gọi + trạng thái + token cuộc gọi ngắn hạn.

---

## 5. Reports / Admin / Moderation / Relationships / Push

### 5.1 MEDIUM — `PATCH /reports/:id/resolve` bỏ qua bước xác nhận lại mật khẩu admin

`src/modules/reports/reports.controller.ts:104-119`, `dto/resolve-report.dto.ts:26-31`, `report-penalty.service.ts:175-177`
Các endpoint xử phạt trực tiếp (`manual-ban`, `quick-penalty`, `unban`, `unmute`, `clear-strike`) đều bắt buộc xác nhận lại mật khẩu qua `verifyAdminPassword()`. Nhưng `resolve` có thể thực hiện hành động tương đương (ban, xoá avatar/bio/tên) qua các field `overridePenaltyAction`, `overridePenaltyDurationDays`, `resetAvatar/Bio/Name` mà **không cần xác nhận mật khẩu**. Admin token bị lộ/đánh cắp có thể ban vĩnh viễn và xoá thông tin bất kỳ user thường nào, bỏ qua hoàn toàn bước xác nhận đã thiết kế cho các endpoint tương tự.

### 5.2 MEDIUM — Push subscription có thể bị chiếm đoạt hoặc vô hiệu hoá bởi người khác

`src/modules/push-subscriptions/push-subscriptions.service.ts:90-117`
`upsert` chỉ khoá theo `endpoint`/`deviceId` (client cung cấp), không ràng buộc với `userId` của người gọi:

- Kẻ tấn công biết `endpoint` của nạn nhân có thể gán lại `userId` về mình → thông báo của nạn nhân bị đẩy sang thiết bị kẻ tấn công.
- Biết `deviceId` của nạn nhân có thể vô hiệu hoá toàn bộ subscription đang hoạt động của họ (DoS thông báo).

### 5.3 LOW/MEDIUM — Hành động "gỡ phạt" (unban/unmute/clear-strike) thiếu kiểm tra phân cấp quyền

`report-admin-action.service.ts:201-342`
Chiều "phạt" có chặn ADMIN phạt ADMIN khác/SUPER_ADMIN, nhưng chiều "gỡ phạt" không kiểm tra tương tự. Một ADMIN cấp thấp có thể gỡ lệnh cấm mà SUPER_ADMIN đã áp đặt.

### 5.4 LOW — `overridePenaltyDurationDays` thiếu validate số nguyên dương

`dto/resolve-report.dto.ts:30-31` — không có `@IsInt @Min(1)` như `ManualBanDto.durationDays`. Giá trị âm/không hợp lệ có thể tạo `banUntil` trong quá khứ hoặc Invalid Date, khiến report bị đánh dấu "đã xử lý" nhưng thực chất không áp dụng hình phạt nào.

### 5.5 LOW — Appeal token có thể fallback sang `JWT_SECRET` nếu thiếu `APPEAL_TOKEN_SECRET`

`report-appeal.service.ts:42-56, 73-77` — ký bằng `APPEAL_TOKEN_SECRET` nhưng verify lại chấp nhận `APPEAL_TOKEN_SECRET || JWT_SECRET`. Nếu biến môi trường `APPEAL_TOKEN_SECRET` chưa cấu hình, phá vỡ tách biệt domain giữa token đăng nhập và token appeal. Nên để fail-hard thay vì fallback.

### 5.6 LOW — `quickPenalty` ép kiểu `reason` tự do thành enum mà không validate

`report-admin-action.service.ts:92,109`, `dto/quick-penalty.dto.ts` — `reason` chỉ là `@IsString`, bị cast cứng sang `ReportReasonEnum`. Giá trị không khớp enum khiến tra `PENALTY_RULES[reason]` ra `undefined` → report bị đóng nhưng không áp dụng phạt gì (silent no-op).

### Đã kiểm tra và an toàn

Toàn bộ endpoint admin (reports, stats, cleanup-jobs, audit-log) đều có `@Roles` + `RolesGuard`; audit-log giới hạn SUPER_ADMIN. Không phát hiện thiếu guard hay IDOR cổ điển. Notifications/relationship đều được lọc theo `userId` người gọi. Không có NoSQL/regex injection (input đã escape).

---

## 6. Cấu hình toàn cục / Bootstrap / Injection

### 6.1 MEDIUM — Injection toán tử Mongo qua query danh sách user + DoS 500

`src/modules/users/users.controller.ts:70-76, 99-105`, `src/modules/users/user-query.service.ts:50,76-78`
`@Query() query: string` nhận nguyên object query của Express (kiểu khai báo `string` không đúng thực tế) — không đi qua DTO nên `ValidationPipe` không lọc được. Ví dụ khai thác:

- `GET /api/v1/users?role[$ne]=USER` → `{ role: { $ne: 'USER' } }` được đưa thẳng vào filter Mongo, vượt qua ý định lọc theo enum.
- `GET /api/v1/users?query[$gt]=` khiến `keyword` là object, gọi `.trim()` → lỗi 500 không bắt (DoS rẻ tiền).

Ngoài ra endpoint `GET /api/v1/users` chỉ có `JwtAuthGuard` global, không có `@Roles` — bất kỳ user đã đăng nhập nào cũng chạm được đường injection này.

**Khắc phục:** dùng DTO có validate cho `query`/`role` (string/enum) thay vì nhận object thô.

### 6.2 MEDIUM — Rate limiter dùng bộ nhớ trong process, không dùng Redis

`src/app.module.ts:47-62` — `ThrottlerModule.forRoot` không cấu hình storage, mặc định lưu trong RAM của từng process. Trên môi trường nhiều instance, giới hạn tốc độ và cơ chế auto-ban theo vi phạm dễ dàng bị vượt qua bằng cách rải request qua nhiều instance; khởi động lại server cũng xoá sạch bộ đếm. Nên dùng storage Redis (project đã có sẵn Redis).

### 6.3 LOW/MEDIUM — Log toàn bộ object lỗi trên luồng auth

`src/auth/auth.service.ts:179, 512` và nhiều nơi trong `chat.gateway.ts`, `realtime-event-bridge.service.ts` dùng `console.log(error)`. Có thể vô tình in ra stack trace, thông tin DB, ngữ cảnh token/session vào log. Nên dùng `Logger` của Nest, chỉ log message, không dump object thô.

### 6.4 LOW — CORS bỏ qua allowlist khi request không có header `Origin`

`src/main.ts:34-38` — request không có `Origin` (curl, server-to-server) được cho qua mặc định dù `credentials: true`. Là đánh đổi phổ biến nhưng cần xác nhận có chủ đích.

### 6.5 LOW — CORS của Socket.IO đọc trực tiếp `process.env`, không qua `ConfigService`

`src/modules/realtime/chat.gateway.ts:53-59` — không nguy hiểm (rỗng thì mặc định từ chối) nhưng có thể lệch cấu hình so với tầng HTTP nếu thứ tự load `.env` khác nhau.

### Đã kiểm tra và an toàn

`ValidationPipe` global có `whitelist + forbidNonWhitelisted + transform`; `helmet()` bật với CSP; CORS dùng allowlist tường minh (không phải `*`); không có secret hardcode; JWT secret không có giá trị mặc định dự phòng (fail nhanh nếu thiếu biến môi trường); Swagger tắt ở production; dependency (NestJS 11, mongoose 9.6, helmet 8.3, bcrypt 6) đều là bản mới, không có lỗ hổng đã biết nổi bật.

---

## Ghi chú

Rà soát này chỉ mang tính phát hiện — chưa thực hiện bất kỳ thay đổi code nào, đúng theo AGENTS.md. Khi bạn chọn mục nào cần sửa, nên xử lý riêng từng mục để giữ thay đổi tối thiểu và đúng phạm vi.
