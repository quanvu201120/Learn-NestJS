import { UserResponse } from '@/modules/users/types/user';
import {
    PenaltyTypeEnum,
    ReportStatusEnum,
} from '@/modules/reports/types/report.type';

export type LoginResponse = {
    accessToken?: string;
    user?: UserResponse;
    isBanned?: boolean;
    banUntil?: string | Date;
    appeal?: {
        reportId: string;
        status: ReportStatusEnum;
        appealDeadline?: string | Date;
        appealReviewDeadline?: string | Date;
        penaltyApplied?: string;
        penaltyType?: PenaltyTypeEnum;
        appealToken?: string;
    };
};

export type RefreshTokenResponse = {
    accessToken: string;
};
