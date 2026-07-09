export enum ReportReasonEnum {
    SPAM_HARASSMENT = 'spam_harassment',
    INAPPROPRIATE_CONTENT = 'inappropriate_content',
    IMPERSONATION = 'impersonation',
    OTHER = 'other',
}

export enum ReportStatusEnum {
    PENDING = 'pending',
    RESOLVING = 'resolving',
    RESOLVED = 'resolved',
    DISMISSED = 'dismissed',
    APPEAL_PENDING = 'appeal_pending',
    APPEAL_REJECTED = 'appeal_rejected',
    APPEAL_SUCCESS = 'appeal_success',
}

export enum PenaltyActionEnum {
    WARNING = 'WARNING',
    MUTE = 'MUTE',
    RESET_AND_WARNING = 'RESET_AND_WARNING',
    RESET_AND_BAN = 'RESET_AND_BAN',
    BAN = 'BAN',
}
