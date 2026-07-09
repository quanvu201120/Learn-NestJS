import {
    IsEnum,
    IsIn,
    IsNotEmpty,
    IsOptional,
    IsString,
} from 'class-validator';
import { PenaltyActionEnum, ReportStatusEnum } from '../types/report.type';

export class ResolveReportDto {
    @IsNotEmpty()
    @IsIn([
        ReportStatusEnum.RESOLVED,
        ReportStatusEnum.DISMISSED,
        ReportStatusEnum.APPEAL_REJECTED,
        ReportStatusEnum.APPEAL_SUCCESS,
    ])
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
