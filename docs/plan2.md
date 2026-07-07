# Kế hoạch triển khai Report & Audit Log

## Bối cảnh & Quyết định kiến trúc

HaloChat sẽ có E2EE trong tương lai. Vì server không thể giải mã nội dung tin nhắn text, hệ thống report được thiết kế ngay từ đầu theo mô hình tương thích E2EE:

- **Report tài khoản** là scope duy nhất — không report từng tin nhắn text.
- **Bằng chứng (Chat)** do chính người report cung cấp (screenshot upload) thay vì server tự thu thập nội dung chat.
- **Snapshot profile** tự động tại thời điểm report để bảo toàn bằng chứng Profile (Avatar/Name/Bio) dù user tự sửa sau đó.
- **Audit Log** ghi lại toàn bộ hành động của Admin/Super Admin, chỉ Super Admin xem được.

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
    'spam_harassment',        // Tin nhắn rác, quấy rối, đe dọa
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
  penaltyApplied: String, // Hình phạt đã áp dụng (Warning + Reset Profile/Mute/Ban/ )

  createdAt: Date,
}
```

**Index:** `{ targetUserId, status }`, `{ reporterId }`, `{ createdAt }`

### 1.2 Data Retention & Garbage Collection (Chính sách lưu trữ bằng chứng)

Để tối ưu chi phí lưu trữ Cloud (AWS/Cloudinary) và đảm bảo bằng chứng, hệ thống áp dụng:

1. **Kiểm tra tham chiếu khi đổi Avatar:** Backend sẽ kiểm tra xem URL avatar cũ có nằm trong bất kỳ `snapshot.avatarUrl` nào không.
    - Nếu **CÓ**: Giữ lại file cũ (vì đang làm bằng chứng).
    - Nếu **KHÔNG**: Xóa ngay file cũ trên Cloud để dọn rác.
2. **Thời gian khiếu nại (Appeal Window):** Sau khi Admin xử lý Report (`resolved` / `dismissed`), user có **30 ngày** để khiếu nại. Trong 30 ngày này, toàn bộ ảnh bằng chứng (`evidenceUrls`, `snapshot`) được giữ nguyên.
3. **Cron Job dọn rác:** Sau 30 ngày, quyền khiếu nại hết hạn. Một Cron Job chạy ngầm sẽ tự động gọi API Cloudinary để xóa sạch các ảnh bằng chứng của Report đó. Bản ghi Report trong DB có thể được giữ lại dưới dạng "Tiền án" (nhưng không còn link ảnh).

### 1.3 API Endpoints

| Method  | Path                   | Quyền  | Mô tả                                     |
| ------- | ---------------------- | ------ | ----------------------------------------- |
| `POST`  | `/reports`             | User   | Tạo report mới                            |
| `GET`   | `/reports`             | Admin+ | Danh sách report (filter: status, reason) |
| `GET`   | `/reports/:id`         | Admin+ | Chi tiết 1 report                         |
| `PATCH` | `/reports/:id/resolve` | Admin+ | Đóng report (resolved/dismissed/phạt)     |

### 1.4 Logic tạo Report & Validate (Chống Spam)

Khi nhận API `POST /reports`, Backend sẽ chạy các luồng kiểm tra sau:

1. **Validate Cơ bản:** `reporterId` không được trùng với `targetUserId` (Tránh tự report bản thân).
2. **Chống Spam Report (Rate Limiting):** Query DB kiểm tra xem User A đã report User B bao nhiêu lần. Nếu **>= 3 lần trong vòng 24h qua**, ném lỗi `BadRequestException` ("Bạn đã gửi quá nhiều báo cáo cho người dùng này hôm nay").
3. **Giới hạn bằng chứng:** `evidenceUrls.length <= 5`.
4. **Snapshot Tự động:** Sau khi qua hết các check trên, Backend tự động fetch thông tin hiện tại của `targetUser` để lưu vào object `snapshot`.

---

## 2. Khung hình phạt (Penalty Ladder)

Khi xử lý Report, để tránh cảm tính từ Admin, hệ thống sẽ **tự động tính toán và đề xuất mức phạt** dựa trên số "Án tích" (Strike) của user. Admin chỉ việc ấn nút "Apply Penalty". Tích hợp các trường `banUntil`, `muteUntil` vào `User` schema.

### 2.1 Cơ chế đếm "Án tích" (Strike Calculation)

Hệ thống tính án tích **tách biệt theo từng loại tội (Reason)** để đảm bảo sự công bằng và nhân văn:

- Không cần tạo thêm trường lưu trữ `strikes` trong bảng User. Số lượng "án tích" được tính trực tiếp bằng cách đếm số lượng Report có `status = 'resolved'` của user đó, được nhóm theo từng `reason`.
- **Ví dụ:** User có 1 tiền án Spam (bị cấm chat 24h). Vài ngày sau user bị report lỗi Avatar/Bio phản cảm -> Hệ thống đếm số tiền án thuộc nhóm `inappropriate_content` đang bằng 0 -> Hệ thống tự động đề xuất phạt ở khung "Lần 1" của tội nội dung (Cảnh cáo + Reset ảnh).

### 2.2 Các công cụ xử phạt

- **Cảnh cáo (Warning):** Gửi thông báo nhắc nhở, không hạn chế tính năng.
- **Mute (Cấm chat):** Vẫn cho đăng nhập nhưng cấm gửi tin nhắn mới (24h - 7 ngày).
- **Reset Profile:** Tự động xóa Avatar/Bio/Tên về mặc định.
- **Suspend (Khóa đăng nhập):** Cấm truy cập app (Tạm thời hoặc Vĩnh viễn).

### 2.3 Quy tắc tính phạt tự động (PENALTY_RULES Constant)

Backend sẽ định nghĩa một hằng số `PENALTY_RULES` để map số lần vi phạm (Strike) ra mức phạt tương ứng. Dựa vào rule này, API sẽ trả về "Mức phạt đề xuất" để Frontend hiển thị cho Admin bấm xác nhận (Admin vẫn có quyền chỉnh tay nếu muốn).
Để tiện cho việc code check `banUntil > now`, án phạt "Vĩnh viễn" (Perma Ban) sẽ được set bằng `36500` ngày (khoảng 100 năm).

```typescript
export const PENALTY_RULES = {
    spam_harassment: [
        { strike: 1, action: 'MUTE', durationDays: 1 }, // Lần 1: Mute 24h
        { strike: 2, action: 'MUTE', durationDays: 7 }, // Lần 2: Mute 7 ngày
        { strike: 3, action: 'SUSPEND', durationDays: 36500 }, // Lần 3+: Khóa vĩnh viễn
    ],
    inappropriate_content: [
        { strike: 1, action: 'RESET_AND_WARNING', durationDays: 0 }, // Lần 1: Chỉ Reset + Cảnh cáo
        { strike: 2, action: 'RESET_AND_BAN', durationDays: 7 }, // Lần 2: Reset + Khóa 7 ngày
        { strike: 3, action: 'RESET_AND_BAN', durationDays: 36500 }, // Lần 3+: Reset + Khóa vĩnh viễn
    ],
    impersonation: [
        { strike: 1, action: 'RESET_AND_BAN', durationDays: 36500 }, // Không có cảnh cáo -> Reset + Khóa vĩnh viễn
    ],
    other: [], // Admin tự đưa ra hình phạt tay
};
```

---

## 3. Tác động đến luồng hiện tại (System Impact)

Việc triển khai hệ thống Report & Phạt tự động sẽ ảnh hưởng trực tiếp đến các logic cốt lõi đang có:

1. **Khả năng Đăng nhập & Chat (Auth & Gateway):**
    - **Đăng nhập (Login API/Guard):** Check thêm điều kiện. Nếu `user.banUntil > new Date()`, ném lỗi `403 Forbidden` (Tài khoản đang bị khóa).
    - **Chat (Socket Gateway):** Thêm `MuteGuard` chặn các event gửi tin nhắn nếu `user.muteUntil > new Date()`.
    - **Force Logout:** Khi Admin bấm chốt án Ban, hệ thống sẽ tự động gọi hàm thu hồi Session (logoutAll). Khi người dùng gọi bất kỳ API nào tiếp theo sẽ tự động văng ra ngoài.

2. **Xóa/Đổi Avatar (`MediaModule` & `UsersModule`):**
    - API xóa ảnh Cloudinary hiện tại phải được bọc lại. Trước khi gọi lên Cloudinary xóa, phải Query DB xem link ảnh đó có tồn tại trong bất kỳ `snapshot.avatarUrl` của 1 Report nào không.
    - Nếu bị gắn trong Report: Giữ lại ảnh (không xóa). Nếu không: Xóa bình thường.

3. **Cấu trúc `User` Schema:**
    - Bổ sung `muteUntil: Date` và `banUntil: Date` (Đại diện cho việc bị Admin xử phạt).
    - **Phân biệt với `isDisabled`**: Trường `isDisabled` cũ chỉ được dùng cho trường hợp **người dùng tự nguyện khóa tài khoản (Deactivate)**. Khi đã khóa, người dùng **không thể tự đăng nhập để mở lại**, mà bắt buộc phải liên hệ Admin để được hỗ trợ mở khóa (Enable) thủ công. Endpoint Disable của Admin sẽ bị loại bỏ.

Phần frontend
**Chuyển đổi luồng thao tác thủ công (Manual Actions) của Admin:** - Thay vì gọi API xóa trực tiếp, các thao tác từ trang Chi tiết User sẽ được chuyển hướng (redirect) qua cơ chế Report ngầm. - **Logic:** Khi Admin bấm "Xóa Avatar" hoặc "Khóa tài khoản" tại trang User, Frontend sẽ gọi một API "Quick Penalty". Backend tự động: 1. Tạo ngầm một Report do chính Admin báo cáo và `status = 'resolved'`. 2. Tự động đếm số án tích (Strike) hiện tại của User đó. 3. Dựa vào `PENALTY_RULES` để đưa ra hình phạt tổng hợp (Ví dụ: bấm Xóa Avatar nhưng phát hiện vi phạm lần 2 -> Hệ thống tự động khóa thêm 7 ngày).
vẫn giữ lại action logoutall ví dụ user báo có nguy cơ bị người lạ vào
nếu account đã disable thì có nút enable
khi ban thủ công thì sẽ hiển thị mức phạt 1d 7d vv cho admin chọn và phải có lý do + xác nhận mật khẩu

---
