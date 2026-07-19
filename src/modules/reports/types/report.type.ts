import type { ResolveReportDto } from '../dto/resolve-report.dto';
import type { UserRole } from '../../users/types/user';
import type { ReportDocument } from '../schemas/report.schema';

export type ResolveReportFunc = (
    id: string,
    resolveDto: ResolveReportDto,
    adminId: string,
    adminRole: UserRole,
    req: any,
) => Promise<any>;

export type CreateAndResolveReportFunc = (
    report: ReportDocument,
    resolveDto: ResolveReportDto,
    adminId: string,
    adminRole: UserRole,
    req: any,
) => Promise<any>;

export enum ReportReasonEnum {
    SPAM_HARASSMENT = 'spam_harassment',
    INAPPROPRIATE_CONTENT = 'inappropriate_content',
    IMPERSONATION = 'impersonation',
    SYSTEM_SPAM = 'system_spam',
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

export enum PenaltyTypeEnum {
    WARNING = 'warning',
    MUTE = 'mute',
    BAN = 'ban',
}
