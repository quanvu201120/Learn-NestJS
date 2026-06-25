# Kế hoạch phát triển tính năng Bạn bè (Friends Feature)

Tài liệu này tổng hợp các quyết định thiết kế và luồng nghiệp vụ (Workflow) cho tính năng Bạn bè và Tin nhắn chờ trong dự án HaloChat, dựa trên các cuộc thảo luận trước đó.

## 1. Thiết kế Cơ sở dữ liệu (Database Schema)

Sử dụng **một Collection duy nhất** có tên `Friendships` (hoặc `Relationships`) để quản lý toàn bộ các trạng thái kết nối giữa 2 User.

**Schema `Friendship`:**
- `requester`: ObjectId (Tham chiếu tới 'User') - Người chủ động gửi yêu cầu hoặc thực hiện hành động chặn.
- `recipient`: ObjectId (Tham chiếu tới 'User') - Người nhận yêu cầu.
- `status`: Enum String gồm 3 trạng thái:
  - `PENDING`: Đang chờ đối phương chấp nhận.
  - `ACCEPTED`: Đã trở thành bạn bè.
  - `BLOCKED`: Một người đã chặn người kia.
- `createdAt`, `updatedAt`: Timestamps mặc định.

**Tối ưu hóa:**
- Tạo Compound Index `(requester, recipient)` với thuộc tính `unique: true` để tránh trùng lặp dữ liệu (ngăn chặn gửi 2 lời mời cùng lúc).

## 2. Luồng hoạt động (Workflows) cốt lõi

### 2.1. Gửi lời mời kết bạn
- **Tiêu chuẩn:** A gửi lời mời cho B -> Lưu `status = PENDING`.
- **Ngoại lệ (Gửi chéo):** Nếu A gửi cho B, nhưng phát hiện B cũng đã gửi cho A và đang ở trạng thái PENDING -> Hệ thống gộp lại và cập nhật thẳng thành `ACCEPTED`.

### 2.2. Phản hồi lời mời
- **Chấp nhận (Accept):** Đổi `status` thành `ACCEPTED`. Bắn sự kiện Socket cập nhật danh sách bạn bè realtime.
- **Từ chối (Reject):** **Xóa vĩnh viễn (Hard delete)** bản ghi khỏi Database. Giúp giảm thiểu rác dữ liệu và cho phép gửi lại lời mời trong tương lai nếu đổi ý.

### 2.3. Hủy kết bạn (Unfriend)
- Xóa vĩnh viễn (Hard delete) bản ghi `ACCEPTED` khỏi Database. Bắn sự kiện Socket để Frontend tự động cập nhật danh sách mà không cần reload.

### 2.4. Chặn (Block)
- Bất kể trạng thái trước đó là gì, cập nhật hoặc tạo mới bản ghi thành `status = BLOCKED` với `requester` là người thực hiện chặn.
- **Hệ quả:** Người bị chặn không thể xem hồ sơ, không thể gửi lời mời mới, và tin nhắn gửi đi sẽ không được thông báo (hoặc bị chặn ở API). Nếu bỏ chặn, 2 người trở thành "người lạ", không tự động khôi phục lại trạng thái bạn bè.

## 3. Thiết kế tính năng "Tin nhắn chờ" (Message Requests)

Giải quyết bài toán tin nhắn từ người lạ mà không cần sửa đổi Schema `Message` hay `User`, tối ưu hóa hiệu năng bằng cách thay đổi ở Schema `Conversation`.

**Cách thực hiện:**
- Thêm cờ `hasAccepted: boolean` vào từng object của mảng `participants` trong collection `Conversations`.

### 3.1. Đối với Chat 1-1
- A nhắn cho B (chưa là bạn bè): A là người khởi tạo nên A mang cờ `hasAccepted: true`. B nhận tin nhắn từ người lạ nên B bị gán `hasAccepted: false`.
- Khung chat này sẽ xuất hiện ở Inbox chính của A, nhưng rơi vào thư mục **Tin nhắn chờ** của B.
- Khi B bấm "Chấp nhận", hệ thống update `hasAccepted = true` cho B, đoạn chat tự động chuyển sang Inbox chính của B.
- *(Nếu A và B đã là bạn bè, backend tự gán `hasAccepted: true` cho cả 2 ngay khi tạo).*

### 3.2. Đối với Chat Nhóm (Chỉ Admin mới có quyền thêm thành viên)
- Khi Admin Group thêm User vào nhóm, backend sẽ kiểm tra mối quan hệ giữa **Admin** và **User được thêm**.
- **Nếu là bạn bè:** User được thêm mang cờ `hasAccepted: true`. Nhóm xuất hiện ở Inbox chính của User đó.
- **Nếu là người lạ:** User được gán `hasAccepted: false`. Nhóm rơi vào mục **Tin nhắn chờ** của User đó. Họ có thể quan sát nhóm và quyết định có bấm "Chấp nhận" tham gia hay không. Cách thiết kế này giúp chống lại việc admin của các nhóm spam tự ý lôi kéo người lạ.

## 4. Gợi ý Layout cho Frontend (Giao diện)

Để đáp ứng việc hiển thị Chat chính, Bạn bè, Tin nhắn chờ, và Danh sách chặn một cách khoa học:
- Áp dụng cấu trúc **Dual Sidebar (Navigation siêu nhỏ bên trái)** giống Zalo PC hoặc Discord.
  - Cột 1 (Ngoài cùng bên trái, hẹp): Chỉ chứa các Icon (Chat, Bạn bè, Tin nhắn chờ, Cài đặt).
  - Cột 2 (Sidebar danh sách): Hiển thị nội dung danh sách phụ thuộc vào Icon được chọn ở Cột 1.
  - Cột 3 (Cửa sổ chính): Nơi hiển thị khung chat hoặc tìm kiếm bạn bè.
