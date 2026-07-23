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

### 3.7 LOW/INFO — Ảnh bằng chứng report trên Cloudinary dùng URL công khai không ký

`src/modules/media/providers/cloudinary.service.ts:133`, `report-media.service.ts:43` — bằng chứng report (có thể nhạy cảm) lưu ở chế độ public delivery, ai có URL cũng xem được, không hết hạn.

### Đã kiểm tra và an toàn

Không có SSRF (không fetch URL do user cung cấp), không có path traversal (`sanitizeFileName` + folder cố định + prefix `randomUUID`), không hardcode secret.

---

## 4. Realtime / WebSocket / Calls / Presence

### 4.1 HIGH — Đăng xuất (logout/logout-all) không ngắt kết nối WebSocket đang mở

## 5. Reports / Admin / Moderation / Relationships / Push

### Đã kiểm tra và an toàn

Toàn bộ endpoint admin (reports, stats, cleanup-jobs, audit-log) đều có `@Roles` + `RolesGuard`; audit-log giới hạn SUPER_ADMIN. Không phát hiện thiếu guard hay IDOR cổ điển. Notifications/relationship đều được lọc theo `userId` người gọi. Không có NoSQL/regex injection (input đã escape).

---

## 6. Cấu hình toàn cục / Bootstrap / Injection

### Đã kiểm tra và an toàn

`ValidationPipe` global có `whitelist + forbidNonWhitelisted + transform`; `helmet()` bật với CSP; CORS dùng allowlist tường minh (không phải `*`); không có secret hardcode; JWT secret không có giá trị mặc định dự phòng (fail nhanh nếu thiếu biến môi trường); Swagger tắt ở production; dependency (NestJS 11, mongoose 9.6, helmet 8.3, bcrypt 6) đều là bản mới, không có lỗ hổng đã biết nổi bật.

---

## Ghi chú

Rà soát này chỉ mang tính phát hiện — chưa thực hiện bất kỳ thay đổi code nào, đúng theo AGENTS.md. Khi bạn chọn mục nào cần sửa, nên xử lý riêng từng mục để giữ thay đổi tối thiểu và đúng phạm vi.
