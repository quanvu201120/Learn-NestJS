import { NotificationTypeEnum } from '../types/notification.type';

export const NOTIFICATION_TITLES = {
    [NotificationTypeEnum.REPORT_RESOLVED]: 'Xử lí vi phạm',
    [NotificationTypeEnum.REPORT_APPEAL_PENDING]: 'Kháng cáo đang chờ xử lý',
    [NotificationTypeEnum.REPORT_APPEAL_REJECTED]: 'Kháng cáo bị từ chối',
    [NotificationTypeEnum.REPORT_APPEAL_SUCCESS]: 'Kháng cáo thành công',
    [NotificationTypeEnum.SYSTEM]: 'Thông báo hệ thống',
    [NotificationTypeEnum.LOGIN]: 'Đăng nhập thiết bị mới',
} as const;
