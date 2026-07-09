import { Type } from 'class-transformer';
import {
    IsEnum,
    IsInt,
    IsMongoId,
    IsOptional,
    IsString,
    Max,
    Min,
} from 'class-validator';
import { ReportReasonEnum, ReportStatusEnum } from '../types/report.type';
import { UserRole } from '../../users/types/user';
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';

export class GetReportsDto {
    @IsOptional()
    @IsEnum(UserRole)
    targetRole?: UserRole;

    @IsOptional()
    @IsEnum(ReportStatusEnum)
    status?: ReportStatusEnum;

    @IsOptional()
    @IsMongoId()
    targetUserId?: string;

    @IsOptional()
    @IsMongoId()
    reporterId?: string;

    @IsOptional()
    @IsMongoId()
    resolvedBy?: string;

    @IsOptional()
    @IsString()
    startDate?: string;

    @IsOptional()
    @IsString()
    endDate?: string;

    @IsOptional()
    @IsEnum(ReportReasonEnum)
    reason?: ReportReasonEnum;

    @IsOptional()
    @IsMongoId()
    reportId?: string;

    @IsOptional()
    @IsString()
    sort?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    current?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(GLOBAL_CONSTANTS.LIMIT_REPORTS_MAX)
    pageSize?: number;
}
