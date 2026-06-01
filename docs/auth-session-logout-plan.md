# Auth Session & Logout Plan

## Mục tiêu
- Logout 1 thiết bị: chỉ revoke đúng session hiện tại.
- Logout all thiết bị: revoke toàn bộ session và vô hiệu access token cũ.

## Kiến trúc
- `User.tokenVersion` dùng cho global revoke (`logout all`).
- `Session` collection dùng cho per-device/per-session control.
- JWT payload chứa: `_id`, `role`, `tokenVersion`, `sessionId` (dùng `Session._id`).

## Schema
### User
- `tokenVersion: number` (default `0`).

### Session
- `userId` (required, index).
- `refreshTokenHash` (required).
- `expiresAt` (required, TTL index).
- `isRevoked` (default `false`).
- `lastUsedAt` (default `Date.now`).
- `userAgent?`, `deviceName?`, `revokedAt?`.

## Index
- `SessionSchema.index({ userId: 1 })`
- `SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })`
- Không cần `sessionId` field riêng nếu dùng `_id` của session.

## Flow Login
1. Xác thực user.
2. Tạo session document mới.
3. Ký access + refresh token với payload có `tokenVersion` và `sessionId` (`session._id`).
4. Hash refresh token và lưu vào `session.refreshTokenHash` + `expiresAt`.
5. Set cookie refresh token.

## Flow Refresh Token
1. Verify refresh token bằng refresh secret.
2. Lấy `user` và check `payload.tokenVersion === user.tokenVersion`.
3. Tìm session theo `sessionId` + `userId`, check:
   - `isRevoked === false`
   - chưa hết hạn
   - `refreshTokenHash` khớp token gửi lên
4. Rotate refresh token:
   - phát token mới
   - cập nhật `refreshTokenHash` mới
   - cập nhật `expiresAt` mới
   - cập nhật `lastUsedAt`
5. Trả access token mới + set cookie refresh mới.

## Flow Logout 1 thiết bị
1. Lấy refresh token hiện tại (cookie) -> decode lấy `sessionId`.
2. Revoke session đó (`isRevoked = true`, `revokedAt = now`).
3. Clear cookie.

## Flow Logout All
1. `user.tokenVersion += 1`.
2. Revoke toàn bộ session của user (`isRevoked = true`, `revokedAt = now`).
3. Clear cookie ở thiết bị hiện tại.

## Guard / Strategy cho Access Token
- Sau verify JWT access token:
1. Check `tokenVersion` khớp user hiện tại.
2. Check session theo `sessionId` còn active (`isRevoked=false`, chưa expire).
3. Sai bất kỳ bước nào -> 401.

## API đề xuất
- `POST /auth/logout` (current session)
- `POST /auth/logout-all`
- Optional:
  - `GET /auth/sessions` (list thiết bị)
  - `DELETE /auth/sessions/:sessionId` (logout thiết bị khác)

## Test cases bắt buộc
1. Logout current: refresh cũ không refresh lại được.
2. Logout all: token ở thiết bị khác bị từ chối.
3. Rotation: refresh token cũ bị reuse thì fail.
4. Multi-device: logout 1 thiết bị không ảnh hưởng thiết bị khác.
5. Concurrent refresh: 2 request đồng thời chỉ 1 request hợp lệ.
