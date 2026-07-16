# Kế hoạch refactor service theo chuyên môn

Mục tiêu của plan này là giảm tình trạng service phình to, nhưng vẫn giữ thay đổi nhỏ, an toàn, không làm đổi API, DTO, endpoint, response shape hay status code hiện có.

## Nguyên tắc refactor

- Chỉ tách nhỏ theo trách nhiệm trong nội bộ từng module.
- Giữ controller mỏng, không chuyển business logic lên controller.
- Giữ nguyên contract public hiện tại của module nếu chưa thật sự cần đổi.
- Ưu tiên tạo các service nội bộ theo use case thay vì tạo helper chung quá sớm.
- Mỗi lần chỉ refactor một module lớn để giảm rủi ro.
- Không refactor chéo nhiều module trong cùng một đợt nếu chưa cần.

## Đánh giá hiện trạng

Các service đang lớn nhất:

- `src/modules/reports/reports.service.ts`: khoảng 1515 dòng
- `src/modules/conversations/conversations.service.ts`: khoảng 1476 dòng
- `src/modules/users/users.service.ts`: khoảng 1313 dòng
- `src/modules/messages/messages.service.ts`: khoảng 915 dòng
- `src/modules/cleanup-jobs/cleanup-jobs.service.ts`: khoảng 630 dòng
- `src/modules/relationships/relationships.service.ts`: khoảng 584 dòng
- `src/modules/stats/stats.service.ts`: khoảng 570 dòng
- `src/modules/media/media.service.ts`: khoảng 537 dòng

Nhận xét:

- `reports.service.ts` là điểm nghẽn lớn nhất vì đang ôm nhiều nhóm nghiệp vụ khác nhau.
- `conversations.service.ts` và `users.service.ts` có khả năng cũng đang giữ quá nhiều trách nhiệm trong cùng một file.
- `messages.service.ts` chưa lớn bằng 3 file trên nhưng đã trộn transaction, media, realtime và business rule.
- `session.service.ts` hiện chưa quá lớn, chưa cần ưu tiên refactor mạnh.

## Ưu tiên refactor

### 1. Reports module

Ưu tiên cao nhất vì đang gom quá nhiều trách nhiệm:

- tạo report
- query report
- appeal token
- appeal flow
- resolve report
- áp dụng penalty
- admin action
- cleanup media/report cũ

Đề xuất tách:

- `report-command.service.ts`
  - `create`
  - `appeal`
  - `resolve`
- `report-query.service.ts`
  - `findAll`
  - `findOne`
  - `findByIdForApi`
  - `findCurrentAppealContextByUserId`
- `report-appeal.service.ts`
  - `generateAppealToken`
  - `verifyAppealToken`
  - `getAppealAccess`
- `report-penalty.service.ts`
  - logic xác định hình phạt
  - apply ban/mute/strike
  - revoke session nếu cần
  - reset avatar/bio/name nếu có
- `report-admin-action.service.ts`
  - `quickPenalty`
  - `manualBan`
  - `unban`
  - `unmute`
  - `clearStrike`
- `report-media.service.ts`
  - upload evidence
  - rollback media khi create/appeal fail
- `report-cleanup.service.ts`
  - `deleteMediasAndReportDismissed`
  - logic xác định media/report orphan

Gợi ý triển khai:

- Giữ `ReportsService` làm facade mỏng ở giai đoạn đầu.
- Controller vẫn inject `ReportsService` để tránh đổi wiring quá nhiều.
- Bên trong `ReportsService` chỉ delegate sang các service nhỏ hơn.

### 2. Conversations module

Ưu tiên thứ hai vì thường là nơi dễ dính nhiều rule:

- tạo direct/group conversation
- quản lý member
- quản lý admin group
- hidden history
- pin/last message
- dissolve group

Đề xuất tách:

- `conversation-query.service.ts`
- `conversation-member.service.ts`
- `conversation-group-admin.service.ts`
- `conversation-state.service.ts`

### 3. Users module

Ưu tiên thứ ba vì service thường thành nơi gom nhiều nghiệp vụ không cùng lớp trách nhiệm.

Đề xuất tách:

- `user-query.service.ts`
- `user-profile.service.ts`
- `user-status.service.ts`
- `user-auth-profile.service.ts`

Lưu ý:

- Chỉ tách khi thật sự có nhóm method rõ ràng.
- Tránh tạo abstraction chung quá sớm giữa `users`, `reports`, `auth`.

### 4. Messages module

Ưu tiên thứ tư vì đang trộn nhiều concern:

- create message
- upload media
- reaction
- pin/unpin
- soft delete
- unseen/realtime
- transaction với conversation và media

Đề xuất tách:

- `message-command.service.ts`
- `message-query.service.ts`
- `message-reaction.service.ts`
- `message-media.service.ts`
- `message-realtime.service.ts`

Lưu ý:

- Đây là module nhạy cảm vì có transaction và side effect.
- Nên refactor sau `reports` để rút kinh nghiệm pattern trước.

### 5. Cleanup-jobs, Stats, Media

Nhóm này có thể refactor sau khi xử lý các service nghiệp vụ chính:

- `cleanup-jobs.service.ts`
  - có thể tách `cleanup-job-command.service.ts`
  - có thể tách `cleanup-job-query.service.ts`
  - có thể tách `cleanup-job-dispatcher.service.ts`
- `stats.service.ts`
  - có thể tách `stats-write.service.ts`
  - có thể tách `stats-read.service.ts`
- `media.service.ts`
  - có thể tách theo upload, persistence, cleanup, provider orchestration

## Đánh giá riêng cho Session module

`src/modules/session/session.service.ts` hiện khoảng 185 dòng, chưa phải service quá lớn.

Nhận xét:

- Phần query session khá gọn.
- Phần revoke session đang bắt đầu dính cleanup job.
- Chưa cần chia mạnh như `reports` hay `messages`.

Nếu muốn chỉnh nhỏ và an toàn:

- có thể tách `session-query.service.ts`
- có thể tách `session-revoke.service.ts`
- hoặc chỉ tách phần enqueue cleanup job sang `session-cleanup.service.ts`

Kết luận:

- `session.service.ts` chưa phải ưu tiên refactor lúc này.
- Chỉ nên đụng khi đang làm flow liên quan session hoặc cleanup job.

## Chiến lược triển khai an toàn

Thứ tự khuyến nghị:

1. Refactor `reports`
2. Refactor `conversations`
3. Refactor `users`
4. Refactor `messages`
5. Sau đó mới xét `cleanup-jobs`, `stats`, `media`

Quy tắc triển khai:

1. Tách file trước, chưa đổi API.
2. Giữ service cũ làm facade trong giai đoạn chuyển tiếp.
3. Di chuyển method theo từng nhóm use case, không di chuyển toàn bộ một lần.
4. Sau mỗi đợt, test lại đúng module vừa thay đổi.
5. Chỉ khi ổn định mới cân nhắc bỏ facade hoặc tinh gọn lại dependency.

## Rủi ro cần tránh

- Tách quá sớm các phần shared dùng chung giữa nhiều module.
- Refactor đồng thời nhiều service lớn khiến khó trace bug.
- Chuyển business logic xuống util/helper thuần khiến mất ngữ nghĩa NestJS module.
- Tạo vòng phụ thuộc mới giữa các service nhỏ sau khi tách.
- Sửa luôn endpoint/DTO/response trong lúc chỉ định refactor cấu trúc.

## Đề xuất bắt đầu thực tế

Nếu bắt đầu làm ngay, nên chọn `reports.service.ts` và đi theo 2 bước:

1. Tách `report-query.service.ts` và `report-media.service.ts` trước vì ít ảnh hưởng hơn.
2. Sau đó tách tiếp `report-appeal.service.ts`, `report-admin-action.service.ts`, `report-cleanup.service.ts`.

Riêng `report-penalty.service.ts` nên tách sau cùng trong module `reports`, vì phần này thường dính nhiều dependency nhất.
