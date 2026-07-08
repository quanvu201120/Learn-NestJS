import { IsEnum, IsMongoId, IsOptional, IsString } from 'class-validator';
import { ReportReasonEnum, ReportStatusEnum } from '../types/report.type';
import { UserRole } from '../../users/types/user';

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
    current?: string;

    @IsOptional()
    pageSize?: string;
}
