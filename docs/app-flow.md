# App Flow

## Mục tiêu file này

File này là bản đồ flow tổng thể của backend hiện tại để:

- nhìn nhanh luồng app đang chạy theo code thật
- giúp FE gọi đúng API, đúng event socket
- tránh nhầm giữa behavior mong muốn và behavior đang implement
- ghi lại các quy ước nội bộ dễ quên, đặc biệt là `cleanup-jobs`

## Tổng quan module

- `auth`: đăng ký, kích hoạt tài khoản, login, refresh token, logout, logout all, đổi mật khẩu, quên mật khẩu
- `users`: CRUD user cơ bản, cập nhật avatar user, disable/enable user
- `session`: lưu session đăng nhập cho access token và refresh token, không có controller public
- `conversations`: tạo direct/group chat, đổi tên nhóm, thêm/xóa thành viên, rời nhóm, giải tán nhóm, đổi admin, ẩn lịch sử, mark as read, avatar nhóm
- `messages`: gửi/lấy tin nhắn, reaction, sửa nội dung tin nhắn text, thu hồi tin nhắn
- `realtime`: socket auth, join room, heartbeat, typing, mark-read, realtime events
- `presence`: API kiểm tra user nào đang online
- `media`: layer upload media/avatar dùng nội bộ cho user, conversation, message
- `redis`: OTP active/forgot password, cooldown gửi mail, presence, typing, unseen conversation
- `cleanup-jobs`: lưu các job dọn dẹp thất bại để retry hoặc truy vết sau

## Guard mặc định

App đang dùng `APP_GUARD` với `JwtAuthGuard` trong `src/app.module.ts`.

- mọi API mặc định đều cần access token
- chỉ route có `@Public()` mới không cần login
- access token được truyền qua `Authorization: Bearer <token>`

Flow validate access token trong `src/auth/passport/jwt.strategy.ts`:

1. verify JWT access token
2. lấy user theo `_id`
3. check `tokenVersion`
4. lấy `session` theo `sessionId`
5. check session đúng owner và chưa bị revoke
6. gắn `req.user = { _id, role }`

## Kiến trúc auth hiện tại

- `accessToken` đi qua header
- `refreshToken` đi qua cookie `refreshToken` dạng `HttpOnly`, `sameSite=lax`
- login tạo `session` mới trong MongoDB
- session lưu `userId`, `refreshTokenHash`, `expiresAt`, `userAgent`, `deviceName`, `lastUsedAt`, `isRevoked`
- `tokenVersion` nằm ở user, dùng để vô hiệu toàn bộ token cũ khi logout all devices hoặc disable account

## Luồng Auth

### 1. Register

Endpoint:

- `POST /auth/register`

Flow backend:

1. nhận `email`, `password`
2. tạo user mới với:
    - `isActive = false`
    - `role = USER`
    - `name = phần trước @ của email`
3. sinh activation code dạng `uuid`
4. hash code rồi lưu Redis với TTL
5. gửi mail kích hoạt
6. trả thông tin user, không trả password

### 2. Activate account

Endpoint:

- `POST /auth/active`

Flow backend:

1. nhận `email`, `code`
2. check user tồn tại và chưa active
3. lấy code hash trong Redis để so sánh
4. đúng thì set `isActive = true`
5. xóa code khỏi Redis

### 3. Resend activation code

Endpoint:

- `POST /auth/resend-code-active`

Flow backend:

1. nhận `email`
2. check user tồn tại và chưa active
3. check cooldown Redis, hiện tại là `60s`
4. sinh code mới, lưu lại Redis, gửi mail
5. response hiện tại là chuỗi `'OK'`

### 4. Login

Endpoint:

- `POST /auth/login`

Flow backend:

1. `LocalAuthGuard` validate `email/password`
2. tạo `session`
3. generate `accessToken` và `refreshToken`
4. hash `refreshToken` rồi lưu vào session
5. set cookie `refreshToken`
6. trả:
    - `accessToken`
    - `user`

Lưu ý:

- response hiện tại không trả `message`
- FE không cần tự lưu refresh token
- nếu có lỗi sau khi đã tạo session, backend sẽ cố `revokeWithCleanup`

### 5. Refresh token

Endpoint:

- `POST /auth/refreshToken`

Flow backend:

1. đọc `refreshToken` từ cookie
2. verify JWT refresh token bằng `JWT_REFRESH_SECRET`
3. check `tokenVersion`
4. check session tồn tại, chưa revoke, chưa hết hạn, đúng owner
5. so sánh `refreshTokenHash`
6. rotate refresh token trong session
7. set lại cookie `refreshToken`
8. trả:
    - `accessToken`

Lưu ý:

- response hiện tại chỉ trả `accessToken`
- nếu refresh token đã hết hạn, service sẽ cố `revokeWithCleanup` session cũ từ payload decode được
- nếu `tokenVersion` lệch hoặc user bị disable, service sẽ cố `revokeAllByUserIdWithCleanup`

### 6. Logout

Endpoint:

- `POST /auth/logout`

Flow backend:

1. route này cần access token
2. backend cố đọc `refreshToken` từ cookie để revoke session hiện tại
3. dùng `revokeWithCleanup` để tránh mất dấu nếu revoke lỗi
4. dù revoke thành công hay không vẫn clear cookie `refreshToken`
5. trả message logout success

### 7. Logout all devices

Endpoint:

- `POST /auth/logoutAll`

Flow backend:

1. cần access token
2. tăng `tokenVersion` của user
3. revoke toàn bộ session chưa revoke của user bằng `revokeAllByUserIdWithCleanup`
4. clear cookie `refreshToken`
5. trả message thành công

### 8. Change password

Endpoint:

- `POST /auth/change-password`

Flow backend:

1. nhận `passwordOld`, `passwordNew`
2. check password cũ
3. hash password mới
4. lưu lại user

Lưu ý:

- đổi mật khẩu hiện tại không tự revoke các session cũ

### 9. Forgot password

Endpoint:

- `POST /auth/forgot-password`

Flow backend:

1. nhận `email`
2. check email tồn tại
3. check cooldown Redis
4. sinh code mới, lưu Redis, gửi mail
5. response hiện tại là chuỗi `'OK'`

### 10. Reset password

Endpoint:

- `POST /auth/reset-password`

Flow backend:

1. nhận `email`, `code`, `password`
2. verify code trong Redis
3. hash password mới
4. save user

Lưu ý:

- reset password hiện tại cũng không revoke session/token cũ

## Luồng Users

Controller: `src/modules/users/users.controller.ts`

### 1. Create user

- Endpoint: `POST /users`
- Guard: chỉ `ADMIN`

### 2. Get users list

- Endpoint: `GET /users`
- Query:
    - `current`
    - `pageSize`
    - ngoài ra service còn parse filter/sort qua `api-query-params`
- Response:
    - `totalPages`
    - `users`

### 3. Get user detail

- Endpoint: `GET /users/:id`

### 4. Update user

- Endpoint: `PATCH /users`
- Rule thực tế trong `UsersService`:
    - `ADMIN` cập nhật được user bất kỳ
    - user thường chỉ cập nhật được chính mình
    - body phải có `_id`

### 5. Upload/Delete avatar user

- `PATCH /users/avatar`
    - form-data field `file`
    - chỉ nhận ảnh, tối đa `5MB`
- `DELETE /users/avatar`

Flow cleanup liên quan:

- nếu xóa file cũ trên Cloudinary lỗi sau khi DB đã commit, backend tạo `cleanup-job`
- job này có:
    - `resourceType = USER_AVATAR`
    - `entityType = USER`
    - `entityId = userId`

### 6. Disable/Enable user

- User tự vô hiệu hóa:
    - Endpoint: `PATCH /users/me/disable`
    - sau khi gọi xong backend sẽ:
        - set `isDisabled = true`
        - set `disabledAt`
        - tăng `tokenVersion`
        - revoke toàn bộ session bằng `revokeAllByUserIdWithCleanup`
        - clear cookie `refreshToken`
- Admin vô hiệu hóa user:
    - Endpoint: `PATCH /users/:id/disable`
- Admin gỡ trạng thái vô hiệu hóa:
    - Endpoint: `PATCH /users/:id/enable`

Rule:

- user thường không có API bật lại account
- admin mới được disable/enable user khác
- admin không enable chính mình qua endpoint admin
- hệ thống giữ nguyên message, conversation, reaction cũ; không hard delete user nữa

## Luồng Session

`session` hiện là persistence layer nội bộ, chưa có public API riêng.

Các thao tác chính trong `src/modules/session/session.service.ts`:

- `create`: tạo session mới lúc login
- `rotateSession`: cập nhật refresh token hash và `expiresAt`
- `revokeWithCleanup`: logout 1 session, nếu revoke lỗi thì tạo `cleanup-job`
- `revokeAllByUserIdWithCleanup`: logout tất cả session của user, nếu lỗi thì tạo `cleanup-job`

Rule hiện tại:

- `JwtStrategy` check session tồn tại và chưa revoke
- socket write actions cũng re-check session qua `validateActiveSession`
- khi disable account, service sẽ tăng `tokenVersion` và revoke toàn bộ session
- `expiresAt` được check rõ ở flow refresh token

## Cleanup Jobs

### 1. Mục đích

`cleanup-jobs` dùng để lưu lại các tác vụ dọn dẹp bên ngoài DB khi thao tác chính đã xong nhưng bước cleanup bị lỗi, ví dụ:

- xóa avatar cũ trên Cloudinary
- xóa file trên R2
- xóa unseen conversation trong Redis
- revoke session khi cần thu hồi token

### 2. Ý nghĩa của `entityType` và `entityId`

Quy ước hiện tại:

- `entityType` cho biết job này phát sinh từ thực thể nào
- `entityId` là id của thực thể đó nếu tại thời điểm tạo job đã có id
- `entityId` có thể vắng mặt nếu flow lỗi xảy ra trước khi thực thể được tạo xong

Ví dụ:

- avatar user bị lỗi cleanup:
    - `entityType = USER`
    - `entityId = userId`
- avatar conversation bị lỗi cleanup:
    - `entityType = CONVERSATION`
    - `entityId = conversationId`
- message upload lỗi trước khi message được persist:
    - `entityType = MESSAGE`
    - `entityId` có thể không có vì message chưa được tạo thành công

### 3. Action và payload

Các action hiện tại:

- `CLOUDINARY_DELETE_ONE`
- `CLOUDINARY_DELETE_MANY`
- `R2_DELETE_ONE`
- `R2_DELETE_MANY`
- `REDIS_REMOVE_UNSEEN_ONE`
- `REDIS_REMOVE_UNSEEN_MANY`
- `SESSION_REVOKE`
- `SESSION_REVOKE_ALL`

Payload bắt buộc theo action:

- `CLOUDINARY_DELETE_ONE`: `publicId`
- `CLOUDINARY_DELETE_MANY`: `publicIds`
- `R2_DELETE_ONE`: `objectKey`
- `R2_DELETE_MANY`: `objectKeys`
- `REDIS_REMOVE_UNSEEN_ONE`: `userId`, `conversationId`
- `REDIS_REMOVE_UNSEEN_MANY`: `userIds`, `conversationId`
- `SESSION_REVOKE`: `userId`, `sessionId`
- `SESSION_REVOKE_ALL`: `userId`

### 4. Resource type đang dùng

- `USER_AVATAR`: cleanup avatar user
- `CONVERSATION_AVATAR`: cleanup avatar conversation
- `MESSAGE_MEDIA`: cleanup media phát sinh trong flow tạo message
- `CONVERSATION_MEDIA`: cleanup toàn bộ media của conversation, ví dụ lúc giải tán nhóm
- `UNSEEN_CONVERSATION`: cleanup cờ unseen trong Redis
- `SESSION`: cleanup/revoke session

### 5. Mapping hiện tại đã chốt

- User avatar:
    - `resourceType = USER_AVATAR`
    - `entityType = USER`
    - `entityId = userId`
- Conversation avatar:
    - `resourceType = CONVERSATION_AVATAR`
    - `entityType = CONVERSATION`
    - `entityId = conversationId`
- Conversation media:
    - `resourceType = CONVERSATION_MEDIA`
    - `entityType = CONVERSATION`
    - `entityId = conversationId`
- Unseen conversation:
    - `resourceType = UNSEEN_CONVERSATION`
    - `entityType = CONVERSATION`
    - `entityId = conversationId`
- Session revoke:
    - `resourceType = SESSION`
    - `entityType = USER`
    - `entityId = userId`
    - `sessionId` nằm trong `payload`
- Message media:
    - `resourceType = MESSAGE_MEDIA`
    - `entityType = MESSAGE`
    - `entityId` có thể không có nếu message lỗi trước khi tạo xong

### 6. Ghi chú quan trọng để khỏi quên

- `entityType/entityId` không phải lúc nào cũng là “đối tượng bị xóa”
- trong codebase hiện tại, nó được hiểu là “thực thể tạo ra cleanup job”
- với `MESSAGE_MEDIA`, không có `entityId` vẫn là đúng ngữ cảnh nếu message chưa được persist

## Data model chat hiện tại

### Conversation

Schema: `src/modules/conversations/schemas/conversation.schema.ts`

Các field chính:

- `name`
- `isGroup`
- `users: ObjectId[]`
- `adminGroupId`
- `lastMessageId`
- `hiddenHistory`
- `readReceipts`
- `avatar`

`hiddenHistory` có shape:

```ts
[
    {
        userId,
        isHidden,
        hiddenAt,
    },
];
```

`readReceipts` có shape:

```ts
{
  [userId]: lastReadMessageId;
}
```

### Message

Schema: `src/modules/messages/schemas/message.schema.ts`

Các field chính:

- `conversationId`
- `senderId`
- `type`
- `content`
- `mediaId`
- `replyTo`
- `isDeleted`
- `deletedAt`
- `reactions`

`type` hiện có cả message hệ thống (`SYSTEM`), không chỉ text/media.

### Media

Schema: `src/modules/media/schemas/media.schema.ts`

Các field chính:

- `uploadedBy`
- `ownerType`
- `ownerId`
- `provider`
- `resourceType`
- `publicId`
- `objectKey`
- `fileName`
- `mimeType`
- `size`

Lưu ý:

- media của avatar user có `ownerType = USER`
- media của avatar conversation và message media hiện lưu với `ownerType = CONVERSATION`

## Luồng Conversations

Controller: `src/modules/conversations/conversations.controller.ts`

### 1. Create conversation

Endpoint:

- `POST /conversations`

Flow backend:

1. merge `currentUserId` vào mảng `users`
2. direct chat phải đúng 2 người
3. group chat phải có ít nhất 3 user tính cả người tạo và bắt buộc có `name`
4. validate toàn bộ user id có tồn tại
5. nếu là direct chat đã tồn tại:
    - nếu room đang bị ẩn bởi current user thì restore
    - nếu không thì trả room cũ
6. nếu là direct chat mới:
    - `hiddenHistory` mặc định sẽ set hidden cho người còn lại
7. nếu là group mới:
    - `adminGroupId = currentUserId`
    - bắn realtime event `conversation:group-created`

### 2. Get conversations of current user

- Endpoint: `GET /conversations`
- chỉ trả những room user đang tham gia và không bị user đó ẩn
- có populate `users`, `lastMessageId`, `avatar`
- sort `updatedAt desc`

### 3. Get conversation detail

- Endpoint: `GET /conversations/:id`
- chỉ trả room nếu user là member và room đó không đang hidden với user này

### 4. Update group info

- Đổi tên nhóm: `PATCH /conversations/:id/update-name`
    - chỉ admin nhóm
- Upload avatar nhóm: `PATCH /conversations/:id/avatar`
    - form-data `file`, chỉ ảnh, tối đa `5MB`
    - chỉ admin nhóm
- Delete avatar nhóm: `DELETE /conversations/:id/avatar`
    - chỉ admin nhóm
- Đổi admin: `PATCH /conversations/:conversationId/change-admin`
    - body `{ newAdminId }`
    - chỉ admin nhóm hiện tại

Flow cleanup liên quan:

- nếu xóa avatar cũ trên Cloudinary lỗi:
    - `resourceType = CONVERSATION_AVATAR`
    - `entityType = CONVERSATION`
    - `entityId = conversationId`

### 5. Manage group members

- Add members: `PATCH /conversations/:id/add-members`
    - body `{ members: string[] }`
    - chỉ admin nhóm
- Remove member: `PATCH /conversations/:id/remove-member`
    - body `{ memberId }`
    - chỉ admin nhóm, trừ trường hợp member tự rời
- Leave group: `DELETE /conversations/:id/leave-group`
    - thực chất gọi chung logic remove member với `memberId = currentUserId`
    - admin hiện tại không được tự leave group
- Disband group: `DELETE /conversations/:id/disband-group`
    - chỉ admin nhóm
    - backend xóa message, media DB, cleanup file R2/Cloudinary rồi xóa conversation

Flow cleanup liên quan khi giải tán nhóm:

- Redis unseen cleanup:
    - `resourceType = UNSEEN_CONVERSATION`
    - `entityType = CONVERSATION`
    - `entityId = conversationId`
- Media cleanup:
    - `resourceType = CONVERSATION_MEDIA`
    - `entityType = CONVERSATION`
    - `entityId = conversationId`

### 6. Hide history

- Endpoint: `DELETE /conversations/:id`

Flow backend:

- không xóa room vật lý
- chỉ set `hiddenHistory.isHidden = true` cho user hiện tại
- khi có tin nhắn mới, room có thể được restore lại tự động

### 7. Mark as read

- Endpoint: `PATCH /conversations/:id/read`
- Body: `{ messageId }`

Flow backend:

1. check message có thuộc conversation không
2. chặn mark read lùi về message cũ hơn
3. set `readReceipts[userId] = messageId`
4. xóa unseen conversation trong Redis cho user đó bằng `removeUnseenConversationWithCleanup`

## Luồng Messages

Controller: `src/modules/messages/messages.controller.ts`

### 1. Get messages list

- Endpoint: `GET /conversations/:conversationId/message?cursor=...`

Behavior thực tế:

- có hỗ trợ `cursor`, nhưng `cursor` là ngày giờ parse được chứ không phải opaque cursor id
- limit cố định `20` bản ghi
- sort `createdAt desc`
- nếu user từng hide room thì chỉ lấy message từ `hiddenAt` trở đi
- response hiện tại là trực tiếp `Message[]`

Lưu ý:

- backend hiện không trả `{ messages, nextCursor }`

### 2. Get latest message

- Endpoint: `GET /conversations/:conversationId/latest-message`
- lấy từ `conversation.lastMessageId`

### 3. Send message qua HTTP

Các endpoint:

- Text: `POST /conversations/:conversationId/message/text`
- Image: `POST /conversations/:conversationId/message/image`
- Video: `POST /conversations/:conversationId/message/video`
- File: `POST /conversations/:conversationId/message/file`
- Voice: `POST /conversations/:conversationId/message/voice`

Notes:

- media endpoints dùng `form-data` field `file`
- body có thể kèm `replyTo`
- image upload lên Cloudinary
- video/file/voice upload lên R2
- khi tạo message thành công backend sẽ:
    - update `lastMessageId`
    - restore room cho các user đang hidden nếu có
    - set unseen conversation cho member online khác
    - emit `chat:new-message`

Flow cleanup liên quan:

- nếu upload file thành công nhưng transaction tạo message lỗi:
    - image:
        - `resourceType = MESSAGE_MEDIA`
        - `entityType = MESSAGE`
        - `entityId` có thể không có
        - action cleanup dùng `CLOUDINARY_DELETE_ONE`
    - video/file/voice:
        - `resourceType = MESSAGE_MEDIA`
        - `entityType = MESSAGE`
        - `entityId` có thể không có
        - action cleanup dùng `R2_DELETE_ONE`

Lý do `entityId` có thể không có:

- message lỗi trước khi được persist nên chưa tồn tại id
- nhưng vẫn biết job này phát sinh từ flow tạo message

### 4. Reaction

- Thêm hoặc update reaction: `PATCH /messages/:messageId/reaction`
    - body `{ conversationId, type }`
- Xóa reaction: `DELETE /messages/:messageId/reaction`
    - body `{ conversationId }`

Lưu ý:

- backend không emit event riêng kiểu `message:reaction-updated`
- reaction update đi chung qua event `message:updated`

### 5. Update/Delete message

Phần này hiện không có HTTP endpoint, mà đi qua socket:

- sửa nội dung text message: event `chat:update-message`
- thu hồi tin nhắn: event `chat:delete-message`

Rule:

- chỉ owner của message mới sửa/xóa mềm được
- chỉ sửa được message `TEXT`
- message bị xóa mềm sẽ set `isDeleted = true`

## Luồng Presence

Controller: `src/modules/presence/presence.controller.ts`

- Endpoint: `POST /presence/users-online`
- Body: `{ userIds: string[] }`
- dùng để hỏi nhanh user nào đang online theo Redis presence

## Luồng Realtime Socket

Gateway: `src/modules/realtime/chat.gateway.ts`

### 1. Connection

Socket connect bằng access token:

```ts
const socket = io('URL_SERVER', {
    auth: { token: accessToken },
});
```

Flow backend:

1. verify JWT access token
2. check user tồn tại
3. check `tokenVersion`
4. check session tồn tại, đúng owner, chưa revoke
5. join room cá nhân `user:{id}`
6. set presence Redis
7. emit `user:online` tới các room conversation liên quan

### 2. Heartbeat

Event:

- emit: `user:heartbeat`

Behavior thực tế:

- Redis presence TTL đang là `120s`
- client nên gửi heartbeat định kỳ để giữ online

### 3. Join conversation room

Event:

- emit: `chat:join-conversation`

Ack trả về:

```ts
{
  ok: true,
  data: {
    conversationId,
    roomName,
    joined: true,
    membersOnline,
  },
}
```

### 4. Create text message qua socket

Event:

- emit: `chat:create-message`

Lưu ý:

- tài liệu cũ ghi "socket chỉ notify" không còn đúng hoàn toàn
- hiện tại socket vẫn tạo được text message
- HTTP API và socket cùng dùng chung service tạo message

### 5. Typing

Events:

- emit: `chat:typing-start`
- emit: `chat:typing-stop`
- listen: `user:typing-update`

Typing state được lưu Redis theo từng socket, TTL `4s`.

### 6. Mark read qua socket

Events:

- emit: `chat:mark-read`
- listen: `user:mark-read`
- listen thêm cho chính user: `user:unseen-cleared`

Backend sẽ:

1. cập nhật `readReceipts`
2. gọi `removeUnseenConversationWithCleanup`

### 7. Delete/Update message qua socket

Events:

- emit: `chat:delete-message`
- listen: `chat:message-deleted`
- emit: `chat:update-message`
- listen: `message:updated`

### 8. Các realtime event khác đang có

- `chat:new-message`
- `user:unseen-message`
- `user:online`
- `user:offline`
- `conversation:group-created`
- `conversation:member-added`
- `conversation:member-removed`
- `conversation:disbanded`
- `conversation:restored`
- `conversation:name-changed`
- `conversation:admin-changed`
