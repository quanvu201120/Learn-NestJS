# Plan 2 - Git Changes Summary

## Tong quan
- Cap nhat luong `reports` de ho tro upload anh chung cu, xu ly trang thai an toan hon khi admin resolve report, va chuan hoa pagination/validation.
- Cap nhat `audit-log` de loc IP an toan hon va lam sach metadata truoc khi luu.
- Bo sung them vai hang so dung chung cho gioi han query va upload file.

## Cac thay doi chinh

### 1. Report evidence upload
- `POST /reports` gio nhan nhieu file anh qua `FilesInterceptor('files', 5, ...)`.
- Chi cho phep file `image/*`, gioi han toi da 5 file, moi file toi da 5MB.
- Khi tao report, cac file duoc upload len Cloudinary va luu thanh `evidenceMediaIds`.
- Neu luu report that bai, media da upload se duoc don lai de tranh rac du lieu.

### 2. Report validation and pagination
- `CreateReportDto` bo field `evidenceMediaIds` vi evidence gio den tu upload file.
- `GetReportsDto` doi `current` va `pageSize` sang kieu so, co `class-transformer` de ep kieu.
- `pageSize` bi gioi han boi `GLOBAL_CONSTANTS.LIMIT_REPORTS_MAX`.
- `GetAuditLogsDto` them gioi han do dai cho `ip`.

### 3. Report resolve flow
- Them trang thai `RESOLVING` cho report de chong 2 admin xu ly cung luc.
- Khi resolve:
  - report duoc claim truoc bang `findOneAndUpdate`
  - xu ly trong transaction
  - rollback trang thai neu co loi
- `calculateAndApplyPenalty` nhan `session` va tra ve ca chuoi penalty lan `banUntil`.
- Sau khi commit, neu user bi ban thi revoke session va phat event `user.banned`.
- Report lien quan cung user/reason se duoc auto resolve/dismiss gop chung nhu truoc, nhung kem logic an toan hon.

### 4. Quick penalty / manual ban
- `quickPenalty` va `manualBan` tao report tam roi goi chung luong resolve.
- Neu resolve loi va report van con o trang thai `PENDING` hoac `RESOLVING`, report tam se bi xoa.

### 5. Audit log improvements
- `AuditLogService` them `sanitizeMetadata()` de chi giu du lieu an toan khi ghi audit log.
- IP filter duoc escape regex truoc khi search de tranh match sai.
- Lay IP tu `x-forwarded-for` co `trim()` de sach hon.

### 6. Constants va message moi
- `GLOBAL_CONSTANTS`
  - them `LIMIT_AUDIT_LOGS_MAX`
  - them `LIMIT_REPORTS_MAX`
- `MEDIA_CONSTANTS`
  - them `REPORT_EVIDENCE_FOLDER`
  - them message upload file: `FILE_UPLOAD_OVER_LIMIT`, `FILE_UPLOAD_EMPTY`
- `REPORT_MESSAGES`
  - them `MEDIA_INVALID_FOR_REPORT`
  - them `REPORT_IS_BEING_PROCESSED`
- `ReportStatusEnum`
  - them `RESOLVING`

## File da bi tac dong
- `src/modules/reports/reports.controller.ts`
- `src/modules/reports/reports.service.ts`
- `src/modules/reports/dto/create-report.dto.ts`
- `src/modules/reports/dto/get-reports.dto.ts`
- `src/modules/reports/dto/resolve-report.dto.ts`
- `src/modules/reports/types/report.type.ts`
- `src/modules/audit-log/audit-log.service.ts`
- `src/modules/audit-log/dto/get-audit-logs.dto.ts`
- `src/modules/media/constants/media.constant.ts`
- `src/common/constants/global.constant.ts`
