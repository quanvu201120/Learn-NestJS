import { IsEnum, IsMongoId, IsOptional, IsString } from 'class-validator';
import { ReportReasonEnum, ReportStatusEnum } from '../types/report.type';

export class GetReportsDto {
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
    current?: string;

    @IsOptional()
    pageSize?: string;
}
