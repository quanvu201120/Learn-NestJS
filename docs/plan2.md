# Kế hoạch triển khai Report & Audit Log

## Bối cảnh & Quyết định kiến trúc

HaloChat sẽ có E2EE trong tương lai. Vì server không thể giải mã nội dung tin nhắn text, hệ thống report được thiết kế ngay từ đầu theo mô hình tương thích E2EE:

- **Report tài khoản** là scope duy nhất — không report từng tin nhắn text
- **Bằng chứng** do chính người report cung cấp (screenshot upload) thay vì server tự thu thập nội dung chat
- **Snapshot profile** tự động tại thời điểm report để bảo toàn bằng chứng dù user tự sửa sau đó
- **Audit Log** ghi lại toàn bộ hành động của Admin/Super Admin, chỉ Super Admin xem được

---

## 1. Report Module

### 1.1 Schema — `report.schema.ts`

```typescript
{
  _id: ObjectId,

  // Người report và đối tượng bị report
  reporterId:    ObjectId,   // ref: User
  targetUserId:  ObjectId,   // ref: User

  // Nội dung report
  reason: enum [
    'spam',
    'harassment',
    'inappropriate_content',  // avatar/tên/bio vi phạm
    'impersonation',
    'other'
  ],
  description: String,        // Mô tả thêm (optional, tối đa 500 ký tự)

  // Bằng chứng do người report upload
  evidenceUrls: [String],     // Tối đa 5 ảnh, mỗi ảnh ≤ 5MB (jpg/png/webp)

  // Snapshot tự động tại thời điểm report (bảo toàn dù user tự sửa)
  snapshot: {
    avatarUrl:   String,
    displayName: String,
    bio:         String,
    capturedAt:  Date,
  },

  // Trạng thái xử lý
  status:     enum ['pending', 'resolved', 'dismissed'],
  resolvedBy: ObjectId,   // ref: User (Admin/Super Admin)
  resolvedAt: Date,
  adminNote:  String,     // Ghi chú của admin khi đóng report

  createdAt: Date,
}
```

**Index:** `{ targetUserId, status }`, `{ reporterId }`, `{ createdAt }`

### 1.2 Cấu trúc thư mục

```text
src/
└── modules/
    └── reports/
        ├── schemas/
        │   └── report.schema.ts
        ├── dto/
        │   ├── create-report.dto.ts
        │   └── resolve-report.dto.ts
        ├── reports.controller.ts
        ├── reports.service.ts
        └── reports.module.ts
```

### 1.3 API Endpoints

| Method  | Path                   | Quyền  | Mô tả                                     |
| ------- | ---------------------- | ------ | ----------------------------------------- |
| `POST`  | `/reports`             | User   | Tạo report mới                            |
| `GET`   | `/reports`             | Admin+ | Danh sách report (filter: status, reason) |
| `GET`   | `/reports/:id`         | Admin+ | Chi tiết 1 report                         |
| `PATCH` | `/reports/:id/resolve` | Admin+ | Đóng report (resolved/dismissed)          |

### 1.4 Logic tạo Report (`reports.service.ts`)

Khi nhận `POST /reports`:

1. Validate: `reporterId` không được trùng `targetUserId`
2. Validate: không được report cùng 1 user quá 3 lần trong 24h (chống spam report)
3. **Tự động fetch và lưu snapshot** của `targetUser` tại thời điểm đó:
    ```typescript
    const targetUser = await this.usersService.findById(targetUserId);
    snapshot = {
        avatarUrl: targetUser.avatarUrl,
        displayName: targetUser.displayName,
        bio: targetUser.bio,
        capturedAt: new Date(),
    };
    ```
4. Lưu report vào DB với `status: 'pending'`
5. (Tùy chọn sau) Notify Admin qua socket/email khi có report mới

### 1.5 Giới hạn upload bằng chứng

- Tối đa **5 ảnh** mỗi report
- Mỗi ảnh ≤ **5MB**
- Format: `jpg`, `png`, `webp`
- Upload lên Cloudinary folder `evidence/reports/{reportId}/`
- URL trả về lưu vào `evidenceUrls[]`

---

## 2. Audit Log Module

### 2.1 Nguyên tắc thiết kế

- **Immutable**: Không ai được xóa hoặc sửa log, kể cả Super Admin
- **Chỉ Super Admin xem được**
- Ghi lại toàn bộ hành động Admin/Super Admin tác động lên tài khoản người dùng hoặc hệ thống quyền

### 2.2 Hành động nào cần log

| Hành động                          | Actor              |
| ---------------------------------- | ------------------ |
| Khóa / Mở khóa tài khoản           | Admin, Super Admin |
| Xóa avatar                         | Admin, Super Admin |
| Reset tên hiển thị                 | Admin, Super Admin |
| Xóa tiểu sử                        | Admin, Super Admin |
| Đăng xuất tất cả thiết bị của user | Admin, Super Admin |
| Tạo tài khoản User                 | Admin, Super Admin |
| Tạo tài khoản Admin                | Super Admin        |
| Cấp / Thu hồi quyền Admin          | Super Admin        |
| Đóng report (resolved/dismissed)   | Admin, Super Admin |

> **Không cần log:** Xem danh sách, tìm kiếm, đọc report (read-only operations)

### 2.3 Schema — `admin-log.schema.ts`

```typescript
{
  _id: ObjectId,

  actorId:    ObjectId,   // ref: User — Admin nào thực hiện
  actorRole:  String,     // Role tại thời điểm thực hiện ('admin' | 'superadmin')

  action: enum [
    'LOCK_USER',
    'UNLOCK_USER',
    'DELETE_AVATAR',
    'RESET_DISPLAY_NAME',
    'DELETE_BIO',
    'FORCE_LOGOUT',
    'CREATE_USER',
    'CREATE_ADMIN',
    'GRANT_ADMIN',
    'REVOKE_ADMIN',
    'DELETE_USER',
    'RESOLVE_REPORT',
    'DISMISS_REPORT',
  ],

  targetId:   ObjectId,   // ID của user/report bị tác động
  targetType: enum ['user', 'report'],

  // Trạng thái trước khi thay đổi
  metadata: {
    // Tùy action, ví dụ:
    oldAvatarUrl:  String,   // DELETE_AVATAR
    oldName:       String,   // RESET_DISPLAY_NAME
    oldRole:       String,   // GRANT_ADMIN / REVOKE_ADMIN
    newRole:       String,
    reason:        String,   // Lý do admin ghi chú khi thực hiện
    reportId:      ObjectId, // Nếu action liên quan đến report
  },

  // Thông tin phiên
  ip:        String,
  userAgent: String,

  createdAt: Date,   // Immutable — không update sau khi tạo
}
```

**Index:** `{ actorId }`, `{ targetId }`, `{ action }`, `{ createdAt: -1 }`

### 2.4 Cấu trúc thư mục

```text
src/
└── modules/
    └── admin-logs/
        ├── schemas/
        │   └── admin-log.schema.ts
        ├── dto/
        │   └── query-log.dto.ts
        ├── admin-logs.controller.ts
        ├── admin-logs.service.ts
        └── admin-logs.module.ts
```

### 2.5 API Endpoints

| Method | Path              | Quyền                | Mô tả                               |
| ------ | ----------------- | -------------------- | ----------------------------------- |
| `GET`  | `/admin-logs`     | **Super Admin only** | Danh sách log (filter + phân trang) |
| `GET`  | `/admin-logs/:id` | **Super Admin only** | Chi tiết 1 log                      |

> Không có `POST`, `PATCH`, `DELETE` — Log chỉ được tạo nội bộ, không có API public

### 2.6 `AdminLogsService` — cách sử dụng

`AdminLogsService` export một method duy nhất để các module khác gọi:

```typescript
// admin-logs.service.ts
async log(params: {
  actorId:    string
  actorRole:  string
  action:     AdminAction
  targetId:   string
  targetType: 'user' | 'report'
  metadata?:  Record<string, any>
  ip?:        string
  userAgent?: string
}): Promise<void>
```

Các service khác inject `AdminLogsService` và gọi sau khi hoàn thành hành động:

```typescript
// users.service.ts (ví dụ)
async deleteAvatar(adminId: string, adminRole: string, userId: string, ip: string) {
  const user = await this.userModel.findById(userId)
  const oldAvatarUrl = user.avatarUrl

  // 1. Xóa trên Cloudinary
  await this.cloudinaryService.delete(user.avatarPublicId)

  // 2. Cập nhật DB
  await this.userModel.updateOne({ _id: userId }, { $unset: { avatarUrl: 1 } })

  // 3. Ghi Audit Log
  await this.adminLogsService.log({
    actorId:    adminId,
    actorRole:  adminRole,
    action:     'DELETE_AVATAR',
    targetId:   userId,
    targetType: 'user',
    metadata:   { oldAvatarUrl },
    ip,
  })
}
```

### 2.7 Query & Filter cho Admin Log

```
GET /admin-logs?actorId=...&targetId=...&action=DELETE_AVATAR&startDate=...&endDate=...&page=1&limit=20
```

---

## 3. Tích hợp với các module hiện có

### `UsersModule`

- Import `AdminLogsModule`, `ReportsModule`
- Các hàm: `lockUser`, `unlockUser`, `deleteAvatar`, `resetDisplayName`, `deleteBio`, `forceLogout`, `deleteUser`, `grantAdmin`, `revokeAdmin` → đều phải gọi `adminLogsService.log()` sau khi thực hiện

### `ReportsModule`

- Import `AdminLogsModule`, `UsersModule` (để lấy snapshot)
- Khi resolve/dismiss report → gọi `adminLogsService.log()` với action tương ứng

---

## 4. Bảo mật Admin Session (FE — ghi nhớ để implement sau)

Quy tắc đã thống nhất, implement phía Frontend:

- **Blur/Visibility → Unmount ngay**: Khi tab mất focus (`visibilitychange` + `window.blur`) → xóa sạch admin state, unmount component, yêu cầu xác thực lại
- **Không cache admin data**: `gcTime: 0`, `staleTime: 0` cho mọi query trong Admin scope
- **Không localStorage**: Admin state chỉ tồn tại trong memory, mất khi F5 hoặc unmount
- **Component isolation**: Admin dashboard là inner component riêng, unmount hoàn toàn khi mất xác thực

### Hành động cần xác nhận mật khẩu (Super Admin)

| Hành động                 | Lý do                       |
| ------------------------- | --------------------------- |
| Tạo tài khoản Admin       | Leo thang đặc quyền         |
| Cấp / Thu hồi quyền Admin | Thay đổi cấu trúc quyền lực |
| Xóa user vĩnh viễn        | Irreversible                |

### Hành động chỉ cần Confirm Dialog

Tất cả các hành động còn lại: khóa/mở khóa, xóa avatar, reset tên, xóa bio, đăng xuất thiết bị.

---

## 5. Thứ tự triển khai đề xuất

1. `AdminLogsModule` — schema + service (không có controller trước)
2. Tích hợp `adminLogsService.log()` vào các hành động admin hiện có trong `UsersModule`
3. `AdminLogsController` — API GET cho Super Admin
4. `ReportsModule` — schema + service + controller
5. FE: Admin session security (blur unmount)
6. FE: Trang quản lý Report
7. FE: Trang Audit Log (chỉ Super Admin)
