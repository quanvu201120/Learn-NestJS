export enum NotificationTypeEnum {
    REPORT_RESOLVED = 'REPORT_RESOLVED',
    REPORT_APPEAL_PENDING = 'REPORT_APPEAL_PENDING',
    REPORT_APPEAL_REJECTED = 'REPORT_APPEAL_REJECTED',
    REPORT_APPEAL_SUCCESS = 'REPORT_APPEAL_SUCCESS',
    SYSTEM = 'SYSTEM',
    LOGIN = 'LOGIN',
}

export type NotificationPenaltyType = 'warning' | 'mute' | 'ban';

export interface NotificationMetadata {
    reportStatus?: string;
    reason?: string;
    penaltyApplied?: string;
    penaltyType?: NotificationPenaltyType;
    appealDeadline?: string | Date;
    appealReviewDeadline?: string | Date;
    deviceName?: string;
    deviceId?: string;
}

export interface CreateNotificationPayload {
    userId: string;
    type: NotificationTypeEnum;
    title: string;
    refId?: string;
    snapshot?: {
        avatarMediaId?: any;
        displayName?: string;
        bio?: string;
        role?: string;
    };
    metadata?: NotificationMetadata;
}

export interface NotificationResponse {
    _id: string;
    userId: string;
    type: NotificationTypeEnum;
    title: string;
    refId?: string | null;
    snapshot?: {
        avatarMediaId?: any;
        displayName?: string;
        bio?: string;
        role?: string;
    };
    metadata?: NotificationMetadata;
    hasAppealed?: boolean;
    isRead: boolean;
    readAt?: string | Date;
    createdAt?: string | Date;
    updatedAt?: string | Date;
}

export interface NotificationsPaginationResponse {
    notifications: NotificationResponse[];
    nextCursor: string | null;
}
