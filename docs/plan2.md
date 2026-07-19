# Plan: Auto ban khi user hit rate limit nhiều lần

## Ý kiến nhanh

Ý tưởng dùng Redis để đếm số lần user bị rate limit trong cửa sổ 5 phút là hợp lý với repo hiện tại. Project đã có `ThrottlerUserIpGuard`, `RedisService.incrWithTTL()`, flow ban qua `ReportsService.resolve()`, revoke session, emit `user.banned`, notification và audit log. Vì vậy nên hook logic ngay tại guard khi request bị throttler chặn, sau đó gọi một service nhỏ để tạo report hệ thống và resolve bằng flow hiện tại.

Không nên xử lý ở từng controller vì sẽ bỏ sót endpoint và làm controller dày. Cũng không nên chỉ set thẳng `user.banUntil` vì sẽ lệch audit/report/appeal/session cleanup hiện tại.

## Rule đề xuất

- Ngưỡng request hiện tại vẫn dùng config throttler: `GLOBAL_LIMIT = 500 req / 1 phút` nếu đang cấu hình như vậy.
- Khi một user đã đăng nhập bị throttler chặn 1 lần, tăng counter Redis:
  - key: `rate-limit:violations:user:{userId}`
  - TTL: `300` giây
  - value: số lần hit throttler trong 5 phút
- Nếu counter đạt `3` trong TTL 5 phút:
  - tạo report hệ thống với reason mới `SYSTEM_SPAM`
  - resolve report bằng penalty override `BAN` trong `1` ngày
  - dùng chung flow report hiện tại để có audit log, revoke session, event `user.banned`, notification và appeal context
  - xoá counter để tránh trigger lặp sau khi ban
- Chỉ auto-ban user đã xác thực. Request anonymous chỉ trả 429 như hiện tại, hoặc nếu muốn thì chỉ đếm IP để quan sát, chưa ban được user.

## Thay đổi tối thiểu nên làm

1. Thêm reason mới
   - File: `src/modules/reports/types/report.type.ts`
   - Thêm `SYSTEM_SPAM = 'system_spam'` vào `ReportReasonEnum`.
   - File: `src/modules/reports/constants/penalty.constant.ts`
   - Có thể thêm rule rỗng cho `system_spam`, vì auto-ban sẽ dùng override `BAN 1 ngày` để không ảnh hưởng strike rule thường.

2. Thêm service xử lý auto-ban trong reports module
   - Gợi ý file: `src/modules/reports/report-system-action.service.ts`
   - Nhiệm vụ:
     - nhận `targetUserId`, metadata rate limit, và `req`
     - kiểm tra user tồn tại, không ban `SUPER_ADMIN`, không giảm án ban nếu user đang bị ban lâu hơn
     - tạo report với:
       - `reporterId`: system actor
       - `targetUserId`: user bị chặn
       - `reason`: `ReportReasonEnum.SYSTEM_SPAM`
       - `status`: `PENDING`
       - `description`: ví dụ `Auto ban: hit rate limit 3 lần trong 5 phút`
       - `snapshot`: avatar/name/bio/role hiện tại
     - gọi `ReportsService.resolve()` với:
       - `status: RESOLVED`
       - `adminNote`: mô tả rule
       - `overridePenaltyAction: PenaltyActionEnum.BAN`
       - `overridePenaltyDurationDays: 1`
   - Cần chốt system actor:
     - tốt nhất thêm env `SYSTEM_ADMIN_ID` trỏ tới một admin/super admin thật trong DB để audit log có `actorId` hợp lệ
     - nếu chưa có, có thể dùng chính user bị ban làm `reporterId` nhưng audit sẽ kém rõ ràng, không nên

3. Hook vào throttler guard
   - File: `src/common/throttler-user-ip.guard.ts`
   - Override method xử lý khi throttler throw 429 hoặc bọc `super.canActivate()` để bắt `ThrottlerException`.
   - Khi catch 429:
     - nếu `req.user?._id` tồn tại, gọi service đếm violation
     - vẫn throw lại exception 429 để giữ response shape/status hiện tại
   - Guard đang là global `APP_GUARD`, nên logic này sẽ áp dụng toàn API sau auth guard.

4. Thêm service đếm Redis
   - Có thể đặt trong `src/common` nếu guard dùng trực tiếp, hoặc trong `reports` nếu muốn gần nghiệp vụ ban.
   - Dùng `RedisService.incrWithTTL(key, 300)`.
   - Nếu count `< 3`: không làm gì thêm.
   - Nếu count `>= 3`:
     - dùng lock Redis chống nhiều request cùng trigger:
       - key: `rate-limit:ban-lock:user:{userId}`
       - TTL: `60` giây
       - `setIfNotExistsWithTTL()`
     - nếu lock lấy được thì gọi auto-ban service
     - xoá counter sau khi ban thành công

5. Import module đúng chiều
   - Vì `ThrottlerUserIpGuard` hiện ở `common` và provider global trong `AppModule`, cần inject được `RedisService` và auto-ban service.
   - Cách ít xáo trộn:
     - export service auto-ban từ `ReportsModule`
     - `AppModule` đã import `RedisModule` và `ReportsModule`, nên guard global có thể inject các provider exported.
   - Nếu phát sinh circular dependency với `ReportsService`, dùng `forwardRef` theo pattern hiện có.

## Luồng chi tiết

1. User gọi API vượt `500 req / phút`.
2. `ThrottlerUserIpGuard` phát hiện request bị throttled.
3. Guard lấy `userId` từ `req.user._id`.
4. Tăng Redis counter `rate-limit:violations:user:{userId}` TTL 5 phút.
5. Lần 1 và 2: trả 429 như hiện tại.
6. Lần 3 trong cùng cửa sổ 5 phút:
   - acquire lock `rate-limit:ban-lock:user:{userId}`
   - tạo report `SYSTEM_SPAM`
   - resolve report bằng `BAN 1 ngày`
   - revoke session và emit realtime qua flow hiện tại
   - audit log ghi `RESOLVE_REPORT` với metadata có reason `system_spam`
7. Các request sau đó bị chặn bởi JWT/user ban check hiện có.

## Rủi ro cần tránh

- Không dùng IP làm tiêu chí ban chính, vì NAT/proxy có thể làm nhiều user chung IP.
- Không auto-ban admin/super admin nếu chưa có rule rõ.
- Không tạo nhiều report khi user spam song song nhiều request, phải có Redis lock.
- Không thay response 429 hiện tại nếu FE đang dựa vào message/status.
- Không tính request anonymous vào án ban user vì chưa xác định được target user.
- Nếu `SYSTEM_ADMIN_ID` sai hoặc user system bị xoá, auto-ban nên fail mềm: vẫn trả 429, không làm crash request.

## Verification khi implement

- Test thủ công hoặc unit cho Redis counter:
  - lần 1 và 2 trong 5 phút không ban
  - lần 3 trigger ban 1 ngày
  - hết TTL thì counter reset
  - concurrent requests chỉ tạo 1 report
- Chạy lint/build.
- Kiểm tra DB:
  - user có `banUntil` khoảng 24h
  - report reason `system_spam`, status `resolved`, penalty type `ban`
  - audit log có action `RESOLVE_REPORT`
- Kiểm tra realtime/session:
  - session bị revoke
  - client nhận `user:banned` như flow ban hiện tại
