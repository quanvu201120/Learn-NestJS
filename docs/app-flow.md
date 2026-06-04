# App Flow

## Mục tiêu file này

File này là bản đồ flow tổng thể của app để:

- nhìn nhanh toàn bộ luồng backend hiện tại
- bám đúng API khi làm frontend
- tránh quên rule nghiệp vụ giữa `auth`, `users`, `session`, `conversations`, `messages`

## Tổng quan module

- `auth`: đăng ký, kích hoạt tài khoản, login, refresh token, logout, đổi mật khẩu, quên mật khẩu
- `users`: quản lý user, xem danh sách, xem chi tiết, cập nhật, xóa
- `session`: quản lý phiên đăng nhập gắn với refresh token
- `conversations`: direct chat, group chat, rename group, add/remove member, hide history, mark as read
- `messages`: hiện mới có schema + helper check message thuộc conversation, nghiệp vụ gửi/lấy lịch sử đang làm tiếp
- `redis`: lưu OTP / cooldown cho active account và forgot password

## Kiến trúc auth hiện tại

- `JWT access token` đi qua header `Authorization: Bearer <token>`
- `refresh token` đi qua cookie `refreshToken`
- mọi login tạo một `session` mới trong MongoDB
- `session` lưu:
    - `userId`
    - `refreshTokenHash`
    - `expiresAt`
    - `userAgent`
    - `deviceName`
    - `isRevoked`
- `tokenVersion` nằm ở `user`
    - dùng để vô hiệu toàn bộ access/refresh token cũ khi logout all devices

## Luồng Auth

### 1. Register

Endpoint:

- `POST /auth/register`

Flow:

1. nhận `email`, `password`
2. check email đã tồn tại chưa
3. hash password
4. tạo user mới với:
    - `isActive = false`
    - `role = USER`
    - `tokenVersion = 0`
5. tạo activation code
6. hash code rồi lưu Redis với TTL
7. gửi email active account
8. trả user info, không trả password

Frontend note:

- sau register cần điều hướng sang màn nhập code active

### 2. Activate account

Endpoint:

- `POST /auth/active`

Flow:

1. nhận `email`, `code`
2. tìm user theo email
3. check user tồn tại và chưa active
4. lấy code hash trong Redis
5. hash code người dùng nhập để so sánh
6. đúng thì set `isActive = true`
7. xóa code trong Redis

### 3. Resend activation code

Endpoint:

- `POST /auth/resend-code-active`

Flow:

1. nhận `email`
2. check user tồn tại và chưa active
3. check cooldown qua Redis TTL
4. tạo code mới
5. lưu lại Redis với TTL mới
6. gửi mail

Frontend note:

- nên hiện countdown resend theo cooldown

### 4. Login

Endpoint:

- `POST /auth/login`

Flow:

1. `LocalStrategy` validate `email/password`
2. check user active
3. tạo `session`
4. generate `accessToken` + `refreshToken`
5. hash `refreshToken`
6. cập nhật session với:
    - `refreshTokenHash`
    - `expiresAt`
    - `lastUsedAt`
7. set cookie `refreshToken`
8. trả:
    - `accessToken`
    - `result` là user
    - `message`

Frontend note:

- access token dùng cho header
- refresh token do cookie giữ

### 5. Refresh token

Endpoint:

- `POST /auth/refreshToken`

Flow:

1. đọc `refreshToken` từ cookie
2. verify JWT refresh token
3. lấy user theo `_id`
4. check `tokenVersion`
5. lấy `sessionId` từ payload
6. check session:
    - tồn tại
    - chưa revoke
    - chưa hết hạn
    - đúng owner
7. hash refresh token cũ và so với `session.refreshTokenHash`
8. generate cặp token mới
9. rotate session với hash mới
10. set lại cookie refresh token mới
11. trả access token mới

### 6. Logout

Endpoint:

- `POST /auth/logout`

Flow:

1. đọc refresh token từ cookie
2. verify token
3. check token thuộc đúng user hiện tại
4. revoke session hiện tại
5. clear cookie refresh token

### 7. Logout all devices

Endpoint:

- `POST /auth/logoutAll`

Flow:

1. lấy user hiện tại
2. tăng `tokenVersion`
3. revoke toàn bộ session chưa revoke của user
4. clear cookie refresh token

Frontend note:

- sau action này nên force về login

### 8. Change password

Endpoint:

- `POST /auth/change-password`

Flow:

1. user phải login
2. nhận `passwordOld`, `passwordNew`
3. check password cũ bằng bcrypt
4. hash password mới
5. lưu lại user

### 9. Forgot password

Endpoint:

- `POST /auth/forgot-password`

Flow:

1. nhận `email`
2. check email tồn tại
3. check cooldown Redis
4. tạo code forgot mới
5. lưu Redis
6. gửi mail

### 10. Reset password

Endpoint:

- `POST /auth/reset-password`

Flow:

1. nhận `email`, `code`, `password`
2. check email tồn tại
3. verify code trong Redis
4. hash password mới
5. save user

## Luồng Jwt Guard

Mặc định app có `APP_GUARD` là `JwtAuthGuard`.

Nghĩa là:

- mọi API mặc định cần access token
- chỉ các route có `@Public()` mới không cần login

Flow validate access token:

1. lấy bearer token từ header
2. verify access token
3. lấy user theo `_id`
4. check `tokenVersion`
5. lấy `session` theo `sessionId`
6. check:
    - session tồn tại
    - đúng owner
    - chưa revoke
7. gắn `req.user = { _id, role }`

## Luồng Users

### 1. Create user

Endpoint:

- `POST /users`

Rule:

- chỉ `ADMIN`

Flow:

1. check email unique
2. hash password
3. tạo user mới

### 2. Get users list

Endpoint:

- `GET /users`

Flow:

1. nhận `query`, `current`, `pageSize`
2. parse filter/sort bằng `api-query-params`
3. query Mongo
4. trả:
    - `totalPages`
    - `userList`

### 3. Get user detail

Endpoint:

- `GET /users/:id`

### 4. Update user

Endpoint:

- `PATCH /users`

Flow:

1. nếu đổi email thì check unique
2. update user
3. không trả password

### 5. Delete user

Endpoint:

- `DELETE /users/:id`

## Luồng Session

Session là persistence layer cho auth.

Các thao tác chính:

- `create`: tạo session mới lúc login
- `rotateSession`: cập nhật refresh token hash mới lúc refresh/login
- `revoke`: logout 1 session
- `revokeAllByUserId`: logout tất cả session

Rule:

- session bị revoke thì access token cũ sẽ fail ở `JwtStrategy`
- session hết hạn sẽ bị TTL index của Mongo cleanup dần

## Data model chat hiện tại

### Conversation

Các field chính:

- `name`
- `isGroup`
- `users: ObjectId[]`
- `adminGroupId`
- `lastMessageId`
- `deletedHistory`
- `readReceipts`

`deletedHistory`:

- lưu trạng thái ẩn conversation theo từng user
- shape:

```ts
[
    {
        userId,
        isDeleted,
        deletedAt,
    },
];
```

`readReceipts`:

- lưu message cuối cùng user đã đọc
- shape:

```ts
{
  [userId]: lastReadMessageId
}
```

### Message

Các field chính:

- `conversationId`
- `senderId`
- `type`
- `content`
- `replyTo`
- `isDeleted`

## Luồng Conversations

### 1. Create conversation

Endpoint:

- `POST /conversations`

Flow:

1. lấy `currentUserId` từ access token
2. merge `currentUserId` vào mảng `users`
3. remove duplicate id
4. nếu direct chat:
    - phải đúng 2 user
5. nếu group:
    - phải có `name`
    - ít nhất 3 user tính cả creator
6. convert toàn bộ sang `ObjectId`
7. check tất cả user có tồn tại
8. nếu direct chat:
    - tìm existing conversation cùng 2 user
    - nếu đã có:
        - nếu user hiện tại từng hide room thì restore `deletedHistory`
        - nếu không thì trả room cũ
9. nếu chưa có thì tạo room mới

Rule direct chat:

- direct room chỉ có 1 room duy nhất cho đúng cặp user

### 2. Get conversations of current user

Endpoint:

- `GET /conversations`

Flow:

1. lọc room chứa `currentUserId`
2. loại các room mà `deletedHistory` của user đang là `isDeleted = true`
3. populate:
    - `users`
    - `lastMessageId`
4. sort `updatedAt desc`

Frontend note:

- đây là API để render chat list

### 3. Get conversation detail

Endpoint:

- `GET /conversations/:id`

Flow:

1. check room tồn tại
2. check `currentUserId` là member
3. check room không bị hide với user đó
4. populate `users`, `lastMessageId`

### 4. Rename group

Endpoint:

- `PATCH /conversations/:id/update-name-conversation`

Rule:

- chỉ group
- chỉ admin group

### 5. Add members

Endpoint:

- `PATCH /conversations/:id/add-members`

Rule:

- chỉ group
- chỉ admin group

Flow:

1. check room tồn tại
2. check room là group
3. check current user là admin
4. check toàn bộ member mới tồn tại
5. `$addToSet` vào `users`

### 6. Remove member

Endpoint:

- `PATCH /conversations/:id/remove-member`

Rule:

- chỉ group
- chỉ admin group
- admin không được remove chính mình bằng API này

Flow:

1. check room tồn tại
2. check room là group
3. check current user là admin
4. check target member thực sự nằm trong room
5. update:
    - `$pull users`
    - `$pull deletedHistory`
    - `$unset readReceipts.<memberId>`

Rule nghiệp vụ:

- user rời nhóm thì xóa luôn:
    - trạng thái hide history
    - trạng thái đã đọc

### 7. Delete history

Endpoint:

- `DELETE /conversations/:id/delete-history`

Ý nghĩa:

- không xóa room vật lý
- chỉ ẩn room với riêng user hiện tại

Flow:

1. check room tồn tại
2. check user là member
3. tìm record `deletedHistory` của user
4. nếu đã `isDeleted = true` thì báo lỗi
5. nếu đã có record:
    - set `isDeleted = true`
    - set `deletedAt = now`
6. nếu chưa có record:
    - push record mới vào `deletedHistory`

### 8. Mark as read

Endpoint:

- `PATCH /conversations/:id/read`

Body:

- `messageId`

Flow:

1. check conversation tồn tại
2. check message tồn tại và thuộc đúng conversation
3. check user là member của conversation
4. lấy `lastReadMessageId` hiện tại từ `readReceipts[userId]`
5. nếu request đang lùi về message cũ hơn mốc đã đọc thì reject
6. nếu hợp lệ thì:

```ts
readReceipts[userId] = messageId;
```

Rule nghiệp vụ:

- cho phép mark tới message mới nhất mà client đang có
- không bắt buộc phải bằng `conversation.lastMessageId`
- chặn read lùi

### 9. Update last message and restore conversation

Method service:

- `updateLastMessageAndRestoreConversation(conversationId, messageId)`

Ý nghĩa:

- dùng sau khi tạo message mới

Flow:

1. update `lastMessageId`
2. restore tất cả record `deletedHistory` đang `isDeleted = true`

Rule nghiệp vụ:

- chỉ restore user đã hide conversation
- user nào đã bị remove khỏi group thì không còn record để restore nữa

## Messages hiện tại
