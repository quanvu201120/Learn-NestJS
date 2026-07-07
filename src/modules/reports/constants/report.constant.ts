export const REPORT_MESSAGES = {
    CANNOT_REPORT_SELF: 'You cannot report yourself',
    TOO_MANY_REPORTS: 'You have submitted too many reports for this user today',
    TARGET_USER_NOT_FOUND: 'The reported user does not exist',
    REPORT_SUBMITTED_SUCCESS: 'Report submitted successfully',
    REPORT_NOT_FOUND: 'Report not found',
    ADMIN_NOT_FOUND: 'Admin not found',
    MISSING_PERMISSION: 'Missing permission',
    CANNOT_PENALIZE_SELF: 'Can not penalize self',
    INVALID_PASSWORD: 'Invalid password',
    CANNOT_PENALIZE_USER: 'You do not have permission to penalize this user',
    CANNOT_PENALIZE_SUPER_ADMIN:
        'You do not have permission to penalize Super Admin',
    NO_AUTO_PENALTY: 'No automatic penalty applied.',
    WARNING_SENT: 'Warning sent.',
    REPORT_INVALID_STATUS: 'Report invalid status',
    MUTE_APPLIED: (duration: number, until: string) =>
        `Muted for ${duration} days (Until ${until}).`,
    RESET_AND_WARNING: 'Avatar/Bio reset and warning sent.',
    RESET_AND_BAN: (duration: number, until: string) =>
        `Avatar/Bio reset and account banned for ${duration} days (Until ${until}).`,
    BAN_APPLIED: (duration: number, until: string) =>
        `Account banned for ${duration} days (Until ${until}).`,
    REPORT_ALREADY_RESOLVED: 'This report has already been processed',
    REPORT_RESOLVED_SUCCESS: 'Report processed successfully',
    QUICK_PENALTY_DESC: 'Quick penalty from Admin',
    QUICK_PENALTY_NOTE: 'Quick penalty',
    MANUAL_BAN_DESC: 'Manual ban from Admin',
    USER_NOT_FOUND: 'User not found',
    UNBAN_SUCCESS: 'Account successfully unbanned',
    APPEAL_SUCCESS: (reason: string) => `Appeal successful: ${reason}`,
    UNMUTE_SUCCESS: 'Account successfully unmuted',
    STRIKE_CLEARED_SUCCESS: 'Strike successfully cleared',
} as const;
