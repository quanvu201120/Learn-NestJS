import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PenaltyActionEnum, ReportStatusEnum } from '../types/report.type';

export class ResolveReportDto {
    @IsNotEmpty()
    @IsEnum([ReportStatusEnum.RESOLVED, ReportStatusEnum.DISMISSED])
    status: ReportStatusEnum;

    @IsOptional()
    @IsString()
    adminNote?: string;

    // Tuỳ chọn cho trường hợp Admin muốn ghi đè hình phạt tự động (nếu có)
    @IsOptional()
    @IsEnum(PenaltyActionEnum)
    overridePenaltyAction?: PenaltyActionEnum;

    @IsOptional()
    overridePenaltyDurationDays?: number;

    @IsOptional()
    resetAvatar?: boolean;

    @IsOptional()
    resetBio?: boolean;

    @IsOptional()
    resetName?: boolean;
}
