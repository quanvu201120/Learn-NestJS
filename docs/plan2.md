# Kế Hoạch Cứng Hóa AuditLog + Reports

## Tóm tắt

Rà soát và harden hai feature `audit-log` và `report` theo hướng an toàn dữ liệu, chỉ sửa đúng những chỗ cần thiết và không đổi behavior ngoài phạm vi yêu cầu.

Ưu tiên cao nhất là luồng bằng chứng của report: user sẽ upload tối đa 5 ảnh, hệ thống tạo `Media` trước, rồi lấy đúng các `mediaId` đó để gắn vào report. Những media này phải chỉ thuộc đúng luồng report đó, không thể lấy media của người khác gắn vào, và cleanup chỉ được phép xử lý trên media thực sự liên quan đến report.

## Cách Xử Lý Theo Findings

- **Bằng chứng có thể bị gắn sai owner hoặc bị dọn nhầm**
    - Chỉ cho phép `evidenceMediaIds` đến từ các record `Media` đã được tạo hợp lệ.
    - Kiểm tra từng `mediaId` phải tồn tại, chưa bị xoá, và thuộc đúng user / đúng luồng report trước khi gắn vào report.
    - Vì hiện tại chưa có API Cloudinary upload multi-file, cần bổ sung luôn luồng tạo nhiều file bằng chứng ở backend/front:
        - nhận tối đa 5 file trong một lần upload,
        - upload từng file thành `Media` record riêng,
        - lấy danh sách `mediaId` trả về để gắn vào report.
    - Khi cleanup, chỉ xoá những media đã xác nhận thuộc report đó, không xoá media chỉ vì nó xuất hiện trong payload.

- **Resolve có thể bị đua request và áp phạt 2 lần**
    - Làm `resolve` theo hướng atomic hoặc idempotent để chỉ có 1 request thắng được trạng thái hợp lệ.
    - Nếu trạng thái report đã đổi trong lúc xử lý, request đến sau phải fail rõ ràng, không được áp phạt lại hoặc tạo audit log trùng.

- **`quickPenalty` và `manualBan` có thể để lại report rác**
    - Gom luồng tạo report tạm và resolve thành một flow an toàn hơn.
    - Nếu resolve fail giữa chừng thì không được để lại report `pending` rác trong DB.

- **Input pagination và filter quá lỏng**
    - Giới hạn `current` và `pageSize` bằng validation trong DTO.
    - Chặn `NaN`, số âm, và giá trị quá lớn trước khi đưa vào `skip` / `limit`.

- **Filter IP và metadata audit log cần harden hơn**
    - Không build regex trực tiếp từ input thô nếu chưa được sanitize rõ ràng.
    - Chỉ giữ metadata cần cho trace, tránh lưu thêm các field không cần thiết.

## Các Thay Đổi Chính

- **Luồng upload bằng chứng**
    - Chuẩn hoá flow: upload media trước, rồi `create report` nhận các `evidenceMediaIds` hợp lệ.
    - Giới hạn mỗi report tối đa 5 ảnh.
    - Bổ sung luồng upload nhiều file bằng chứng từ đầu đến cuối, vì hiện tại Cloudinary chưa có API multi-file riêng.
    - Kiểm tra ownership và sự tồn tại của `mediaId` trước khi link vào report.
    - Cleanup chỉ xoá media thuộc report đó, không đụng media bên ngoài.

- **Tính toàn vẹn của report**
    - Làm `resolve report` an toàn trước race condition.
    - Tránh để lại report tạm trong `quickPenalty` và `manualBan` nếu có lỗi ở giữa luồng.
    - Siết validation cho pagination và filter để tránh query quá lớn hoặc không hợp lệ.

- **Harden audit log**
    - Giữ quyền truy cập chỉ cho `SUPER_ADMIN`.
    - Làm an toàn hơn phần filter IP, giảm nguy cơ query regex quá rộng.
    - Giữ metadata đủ phục vụ audit nhưng không lưu dư dữ liệu.

## Giả Định

- Luồng bằng chứng sẽ đi theo kiểu "upload media trước, report chỉ nhận `mediaId` hợp lệ".
- Luồng upload bằng chứng sẽ hỗ trợ nhiều file trong một lần, nhưng backend sẽ xử lý từng file thành `Media` riêng.
- Mỗi media bằng chứng chỉ được gắn với đúng một report trong flow này, nhưng một report vẫn có thể chứa tối đa 5 media bằng chứng.
- Không mở rộng thêm feature mới ngoài việc harden và tối ưu hai module hiện có.
