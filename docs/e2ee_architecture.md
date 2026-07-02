# KIẾN TRÚC MÃ HÓA ĐẦU CUỐI (E2EE) CHO HALOCHAT

Tài liệu này tổng hợp toàn bộ thiết kế kiến trúc, các vấn đề rủi ro và cách giải quyết cho tính năng Mã hóa đầu cuối (E2EE) trên nền tảng Web App.

---

## 1. Định hướng chung (Core Strategy)

- **Mã hóa Mặc định (Default E2EE):** Áp dụng mã hóa cho tất cả các cuộc trò chuyện, không bắt người dùng phải tự tay bật/tắt "Trò chuyện bí mật".
- **Cấp độ mã hóa:** Mã hóa theo **Cuộc trò chuyện (Per-Conversation)** thay vì mã hóa theo từng tin nhắn (Double Ratchet) để tối ưu hiệu năng cho trình duyệt Web. Việc này có nghĩa là ứng dụng chỉ đẻ khóa mới khi có sự kiện (Key Rotation) thay vì mỗi tin nhắn đẻ một khóa.
- **Mục tiêu bảo mật:** Máy chủ (Server) chỉ làm nhiệm vụ giao hàng và lưu trữ, hoàn toàn "mù tịt" (Zero-Knowledge) không thể đọc được nội dung tin nhắn.

---

## 2. Các Bài toán lớn và Cách giải quyết

### Bài toán 1: Quản lý khóa cho Nhóm (Group Chat) và 1-1

> **Vấn đề:** Nếu nhóm có 50 người, không thể lấy tin nhắn mã hóa 50 lần gửi đi vì sẽ làm sập Server và treo trình duyệt. Tương tự với chat 1-1.

- **Cách giải quyết:** Áp dụng **Khóa phòng chat (Shared Symmetric Key / AES Key)**.
- **Cơ chế:**
    1. Bản chất chat 1-1 hay Group đều dùng chung một thuật toán (1-1 là Group 2 người).
    2. Người gửi đẻ ra đúng 1 cái Khóa Phòng (VD: `Key_A`). Tin nhắn được mã hóa 1 lần bằng `Key_A`.
    3. Một User có thể có nhiều thiết bị, do đó họ có 1 **Mảng Public Key** (Mỗi thiết bị 1 Public Key).
    4. Để phân phát `Key_A`: Người gửi photo `Key_A` ra nhiều bản, bọc qua từng Public Key của tất cả các thiết bị trong nhóm rồi ném lên Server.
    5. Thiết bị nào nhận được "Gói hàng" bọc bằng Public Key của nó thì lấy Private Key ra mở.

### Bài toán 2: Đổi thiết bị làm mất tin nhắn cũ

> **Vấn đề:** Private Key nằm chết ở thiết bị cũ. Khi đăng nhập máy mới, Server đổ về 1 đống tin nhắn nhưng máy mới không có chìa khóa để giải mã, dẫn đến mất lịch sử chat.

- **Cách giải quyết:** Cơ chế **Két sắt khóa bằng Mật khẩu (Secure Secret Storage)** trên Database Server.
- **Cơ chế:**
    1. Gom tất cả chìa khóa của các phòng chat vào 1 mảng.
    2. Bắt người dùng tạo một **Mật khẩu khôi phục**.
    3. Dùng mật khẩu đó để mã hóa cái Mảng kia thành 1 cục rác (Payload Base64).
    4. Lưu cục rác đó thẳng lên Database của Server (bảng `KeyBackups`).
    5. Khi sang máy mới: Tải cục rác về -> Nhập Mật khẩu khôi phục -> Trình duyệt tự giải mã -> Lấy lại trọn vẹn chùm chìa khóa cũ.

### Bài toán 3: Phân phát Khóa mới khi thành viên Offline

> **Vấn đề:** Khi có sự kiện Đổi khóa, một số thành viên đang tắt máy (Offline) thì làm sao nhận được Khóa mới?

- **Cách giải quyết:** Cơ chế **Hộp thư chờ (Asynchronous Delivery)**.
- **Cơ chế:**
    1. Người gửi ném "Gói hàng chứa Khóa" đã bọc Public Key lên Server.
    2. Server lưu Gói hàng này vào Database (Inbox chờ) của người nhận. Server không thể đọc được.
    3. Vài ngày sau, người nhận Online. Quá trình `init()` khi mở app sẽ chọc vào Inbox tải các Gói hàng đang chờ về và dùng Private Key để mở.

### Bài toán 3.1: Các điều kiện kích hoạt Đổi khóa (Key Rotation)

> **Vấn đề:** Khi nào thì một cuộc trò chuyện bắt buộc phải đập bỏ Khóa phòng cũ và đẻ ra Khóa phòng mới?

- **Quy tắc:** Bất cứ khi nào có sự thay đổi về **Nhân sự** hoặc **Thiết bị** ảnh hưởng đến bảo mật, hệ thống bắt buộc phải **Đổi khóa (Key Rotation)**.
- **5 Kịch bản bắt buộc Đổi khóa:**
    1. **Có thiết bị mới đăng nhập:** Để đảm bảo nếu tên trộm cầm máy mới, hắn không thể đọc được tin nhắn cũ (nếu không có Két sắt).
    2. **Thêm thành viên mới (Add Member):** Để người mới vào nhóm không thể đọc trộm tin nhắn lịch sử trước khi họ tham gia.
    3. **Đuổi thành viên (Kick Member):** Để người bị đuổi không thể đọc các tin nhắn trong tương lai (Forward Secrecy).
    4. **Tự rời nhóm (Leave Group):** Tương tự như bị đuổi.
    5. **Tự logout hoặc bị cưỡng chế logout từ thiết bị khác** Khi thiết bị bị Server "đá" ra, khóa phải đổi ngay lập tức để thiết bị đó biến thành cục gạch, không nhận được thư mới nữa.

### Bài toán 4: Chùm chìa khóa (Key Ring) hoạt động thế nào trên 1 máy?

> **Vấn đề:** Máy mới chat sinh ra Khóa Mới (VD: `Key_002`). Sau khi nhập mật khẩu khôi phục, lấy lại được Khóa Cũ (`Key_001`). Làm sao phân biệt chìa nào mở cửa nào?

- **Cách giải quyết:** Dán nhãn chìa khóa vào Database (Cột `room_key_id` trong bảng `Messages`).
- **Cơ chế:** Trình duyệt cầm 1 chùm chìa khóa (`[Key_001, Key_002]`). Lướt qua danh sách tin nhắn, thấy mác `Key_001` thì rút chìa số 1 ra mở, thấy `Key_002` thì rút chìa số 2. Cực kỳ rành mạch.

### Bài toán 5: Lỗ hổng "Offline Gap" và Cách lấp đầy

> **Vấn đề:** Thằng B bị rớt mạng. Thằng A đẻ Khóa 4 và 5 ném vào Inbox của B. Sau đó B làm mất điện thoại cũ, đăng nhập điện thoại mới. Điện thoại mới tải Inbox về nhưng KHÔNG CÓ Private Key cũ nên chịu chết không mở được Khóa 4 và 5.

- **Cách giải quyết (Lưu Private Key vào Két sắt):** Lúc tạo Két sắt ở máy cũ, ngoài việc lưu Khóa phòng `[1, 2, 3]`, trình duyệt nhét luôn **Private Key của máy cũ** vào Két sắt. Nhờ vậy, khi qua máy mới và nhập Mật khẩu khôi phục, B lấy lại được Private Key cũ -> Dùng nó mở đống Inbox bị kẹt -> Cứu được trọn vẹn Khóa 4 và 5 mà không cần van xin ai!

### Bài toán 6: Chat tiếp trên máy mới mà chưa nhập mã khôi phục (UX Flow)

> **Vấn đề:** Đăng nhập máy mới mà làm biếng chưa gõ Mật khẩu khôi phục. Làm sao để ứng dụng không bị "block" cứng đơ?

- **Cách giải quyết:** Thuật toán **Đổi Khóa Tự Động (Key Rotation) & Giao diện Non-blocking**.
- **Cơ chế:** Máy mới đẻ Public Key mới. Bạn bè thấy vậy sẽ tự động Đập bỏ Khóa Phòng cũ -> Tạo Khóa Phòng Mới Tinh gửi cho máy mới. User chat tiếp bình thường đọc được tin nhắn mới. Tin nhắn đồ cổ hiện UI 🔒 _"Tin nhắn mã hóa, vui lòng nhập mã khôi phục"_. Không block luồng chat.

### Bài toán 7: Thảm họa Mất Máy + Quên Mật khẩu Khôi phục

> **Vấn đề:** Mất máy cũ, mua máy mới, và quên sạch Mật khẩu khôi phục Két sắt?

- **Sự thật tàn nhẫn:** **Mất sạch tin nhắn cũ VĨNH VIỄN**. Không một ai cứu được.
- **Luồng xử lý "Đặt lại mật khẩu":** Người dùng buộc phải bấm _"Đặt lại mật khẩu khôi phục"_. Hành động này gọi API tự tay đập nát cái Két sắt cũ trên Server. Tạo 1 Két Sắt mới tinh. Chấp nhận bỏ quá khứ, làm lại từ đầu.

### Bài toán 8: Vấn đề Scale (Két sắt phình to) và Khóa tạm

> **Vấn đề:** Đăng nhập tab ẩn danh liên tục, tham gia quá nhiều group làm Két sắt chứa cả triệu Khóa?

- **Thực tế:** Một khóa AES chỉ 32 bytes. 10.000 khóa chỉ tốn chưa tới 1 MB.
- **Khóa tạm (Unverified Key) vs Khóa chính thức:**
    - Log in ẩn danh -> Đẻ Device Key -> Đóng tab là rác. (Không bao giờ lưu vào Két sắt).
    - Chỉ khi User **nhập Mật khẩu khôi phục** trên thiết bị đó, hệ thống mới "Xác nhận (Verify)" thiết bị này và ghim khóa của nó vào Két sắt.
- **Dọn rác:** Tự động giới hạn Max Session (đá thiết bị cũ), xóa khóa khi user tự tay Xóa tin nhắn/Giải tán nhóm.

### Bài toán 9: Điểm yếu chí mạng của Web App & Lưu Key ở đâu?

> **Vấn đề:** Lưu Khóa giải mã ở LocalStorage rất dễ bị Mã độc (XSS) móc túi.

- **Cách giải quyết:** Lưu chùm chìa khóa (Key Ring) đã giải mã vào **React State (RAM / Zustand)**.
- **Ưu điểm:** Cực kỳ bảo mật, mã độc XSS không thể lấy được.
- **Nhược điểm (Đánh đổi UX):** F5 (Tải lại trang) là mất sạch khóa. Trình duyệt sẽ bắt User gõ lại Mật khẩu khôi phục. (Tương tự ứng dụng Ngân hàng).
- **Mô hình đe dọa (Threat Model):** Cần làm rõ rằng E2EE vô dụng nếu máy khách bị nhiễm Keylogger hoặc phần mềm chụp màn hình.

### Bài toán 10: Giới hạn vật lý - Khi Hacker cướp được thiết bị gốc (Root Device)

> **Vấn đề:** Máy cũ (số 1) bị mất trộm. Bạn sang máy mới (số 2) đăng nhập, hệ thống tự động "Đá" máy số 1 ra. Vậy tên trộm ôm cái máy số 1 có đọc được tin nhắn không?

- **Phân tách Khóa Phòng (Room Key) và Ổ Khóa Thiết bị (Device Public Key):**
    - Để khóa tin nhắn, ta dùng **Khóa Phòng** (Ví dụ `Key 6`).
    - Để giao Khóa Phòng, ta bọc nó bằng **Public Key của từng thiết bị**.
- **Bảo vệ Tương lai (Forward Secrecy):** Hoàn hảo 100%.
    - Khi máy 1 bị đá, Server lập tức xóa sổ Public Key của máy 1.
    - Người gửi (User A) đẻ ra Khóa Phòng Mới (`Key 7`). User A thấy máy 1 đã chết trên Server, nên **KHÔNG BỌC** `Key 7` cho máy 1 nữa.
    - 👉 Tên trộm cầm máy 1 vĩnh viễn không nhận được Gói hàng chứa `Key 7`. Tương lai bị chặt đứt, tên trộm MÙ thông tin hoàn toàn với các tin nhắn mới.
- **Bảo vệ Quá khứ (Post-Compromise Security):** Đây là giới hạn của mọi hệ thống E2EE.
    - Vì tên trộm cầm vật lý cái máy 1, máy 1 đã có sẵn trong bụng nó Két sắt và các Khóa phòng cũ (`Key 1, 2, 3, 4, 5, 6`).
    - Nước đổ đi không thể hốt lại. App chat không thể xóa dữ liệu từ xa nếu tên trộm **Tắt Wifi / Rút cáp mạng**.
    - 👉 Quá khứ phụ thuộc 100% vào **Bảo mật Hệ điều hành** (Passcode màn hình, FaceID). Nếu không có Passcode màn hình, tên trộm sẽ đọc được toàn bộ tin nhắn trước thời điểm bị đá.
- **Cách giải quyết triệt để:** Sử dụng tính năng **Tin nhắn tự hủy (Disappearing Messages)** sau 7 ngày để dọn sạch rác vật lý trên ổ cứng.

### Bài toán 11: Đụng độ dữ liệu Két sắt (Race Condition)

> **Vấn đề:** User A có 2 thiết bị Gốc (Root Device) đang online cùng lúc. Khi có Khóa Mới gửi đến, cả 2 thiết bị đều tự động giải mã và tranh nhau "Update Két sắt" lên Server cùng một nano-giây. Dữ liệu sẽ bị ghi đè làm hỏng Két sắt?

- **Cách giải quyết:** Sử dụng **Optimistic Locking (Khóa Lạc Quan)** thông qua Versioning trên Database.
- **Cơ chế:**
    1. Cột `version` được thêm vào bảng Két sắt (`KeyBackups`). Giả sử Két sắt đang là `version = 10`.
    2. Cả 2 máy tải `version 10` về, nhét Khóa Mới vào, đẩy lên Server với câu truy vấn: `UPDATE KeyBackups SET payload = X, version = 11 WHERE version = 10`.
    3. Nhờ tính chất ACID của Database (Row-level lock), 2 câu lệnh bay vào cùng một nano-giây vẫn bị ép xếp hàng.
    4. **Máy 1 (Nhanh hơn):** Giành được quyền khóa dòng dữ liệu, update thành công lên `version 11`.
    5. **Máy 2 (Chậm hơn):** Bắt đầu update thì phát hiện `version` lúc này đã là 11 (điều kiện `WHERE version = 10` bị SAI). Database từ chối bản cập nhật (0 rows affected).
    6. Nhờ vậy, dữ liệu không bao giờ bị ghi đè. Máy 2 bị từ chối sẽ tự động tải Két sắt `version 11` về và thấy Khóa Mới đã nằm sẵn trong đó rồi (do Máy 1 làm dùm) nên bỏ qua!

### Bài toán 12: Vòng đời Thiết bị (Lifecycle) và Khác biệt Đăng xuất vs Xóa Két sắt

> **Vấn đề:** Phân biệt hành vi Đăng xuất (Logout), Đăng xuất tất cả (Logout All), và Đặt lại Mật khẩu khôi phục (Reset Safe).

- **Khái niệm cốt lõi:** Két sắt (Master Key) nằm trên đám mây, hoàn toàn độc lập với Thiết bị vật lý.
- **Trạng thái 1: Đăng nhập (Tạo Khóa tạm):** Đăng nhập đẻ ra Device Key. Khóa này là "Khóa phụ" (Unverified), không được quyền đụng vào Két sắt.
- **Trạng thái 2: Xác thực (Thăng cấp Root Device):** Nhập Mật khẩu khôi phục thành công -> Máy được cấp quyền sờ vào Két sắt (Root Device). Két sắt tải về máy.
- **Trạng thái 3: Đăng xuất Chủ động (Graceful Logout):**
    - Bấm đăng xuất trực tiếp trên máy đang cầm. Xóa Private Key cục bộ, gọi API xóa Public Key trên Server. Các máy khác tự động **Đổi khóa (Key Rotation)**.
    - **Dọn rác Két sắt:** Vì máy đã kịp tải toàn bộ Hộp thư chờ (Inbox) và lưu Khóa phòng vào Két sắt trước khi thoát, ta **ĐƯỢC PHÉP xóa Private Key của máy này khỏi Két sắt** để chống phình to dữ liệu. Két sắt VẪN CÒN.
- **Trạng thái 4: Đăng xuất từ xa / Bị ép đá văng (Remote Logout / Logout All):**
    - Dùng máy A để đá máy B, hoặc máy B vượt quá giới hạn thiết bị nên bị Server đá. Server xóa Public Key của máy B. Máy B mù tương lai.
    - **Chống Offline Gap:** Vì máy B bị đá bất ngờ, nó chưa kịp mở các Gói hàng đang kẹt trong Inbox. Ta **KHÔNG ĐƯỢC xóa ngay Private Key của máy B khỏi Két sắt**. Phải giữ lại để các máy khác có cơ hội lấy Private Key này giải mã nốt các Gói hàng kẹt trong Inbox. Sau khi cứu xong thư thì mới được xóa để dọn rác.
- **Trạng thái 5: Đặt lại Mật khẩu khôi phục:** Đây là hành động duy nhất có quyền **TỬ HÌNH** cái Két sắt. Két sắt cũ bị xóa trắng trên Database, tạo Master Key mới và Két sắt mới. Toàn bộ quá khứ bị hủy diệt.

### Bài toán 13: Đảm bảo toàn vẹn dữ liệu khi nhận Khóa (Crash Recovery & Transaction)

> **Vấn đề:** Đang nhận Gói hàng Khóa qua Socket thì rớt mạng, sập nguồn, hoặc tắt trình duyệt giữa chừng. Két sắt chưa kịp cập nhật Khóa mới thì dữ liệu có bị mất vĩnh viễn không?

- **Quy trình xử lý hoàn hảo (Real-time Fallback & ACK):**
    1. **Write-ahead Logging (Lưu trước):** Bất kể người nhận đang Online hay Offline, Server luôn phải lưu Gói hàng vào Tủ giao hàng (Bảng `Inbox` Database) trước tiên.
    2. **Real-time Emit:** Server check Redis Pub/Sub, thấy User đang Online thì bắn `socket.emit('new_room_key')` để giao hàng ngay lập tức.
    3. **Crash Recovery (Dự phòng sập nguồn):** Nếu User bị sập nguồn lúc này, Gói hàng vẫn nằm an toàn trong tủ `Inbox`. Lần tới User F5 hoặc truy cập Web, hàm `init()` sẽ tự động quét `Inbox` và lôi Gói hàng ra xử lý lại từ đầu.
- **Cú chốt hạ bằng Database Transaction:**
    - Khi Trình duyệt xử lý xong (giải mã và lấy được Khóa phòng), nó gọi API để làm 2 việc: **(A) Thêm Khóa vào Két sắt** và **(B) Xóa Gói hàng khỏi Inbox**.
    - Hai hành động này trên Backend bắt buộc phải được bọc trong một **Database Transaction (Cùng sống cùng chết)**. 
    - Nếu Xóa thư thành công mà Lưu Két sắt thất bại -> Lệnh bị Rollback (Hoàn tác) ngay lập tức. Tránh tuyệt đối thảm họa Gói hàng bị xóa mất mà Khóa thì chưa kịp cất vào Két sắt!

---

## 3. Kiến trúc CSDL tham khảo (Database Schema)

**Bảng `RoomKeys` (Khóa phòng chat)**

- `id` (PK)
- `conversation_id`
- `encrypted_key_value` (Chìa khóa phòng nhưng đã bị bọc qua Public Key của User)
- `status` (active / inactive)

**Bảng `Messages` (Tin nhắn)**

- `id` (PK)
- `conversation_id`
- `content` (Ciphertext - Chuỗi đã bị mã hóa)
- `room_key_id` (FK -> `RoomKeys.id`)

**Bảng `KeyBackups` (Két sắt sao lưu)**

- `user_id` (PK)
- `encrypted_payload` (Chuỗi JWT chứa toàn bộ chùm chìa khóa + Private Key Master, bị khóa bằng Mật khẩu khôi phục)
