import {
    IsEnum,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Min,
} from 'class-validator';
import { PenaltyActionEnum, ReportStatusEnum } from '../types/report.type';
import { VALIDATION_MESSAGES } from '@/common/constants/validation.constant';

export class ResolveReportDto {
    @IsNotEmpty({ message: VALIDATION_MESSAGES.STATUS_REQUIRED })
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

    @IsNotEmpty({ message: VALIDATION_MESSAGES.PASSWORD_REQUIRED })
    @IsString()
    password?: string;

    // Tuỳ chọn cho trường hợp Admin muốn ghi đè hình phạt tự động (nếu có)
    @IsOptional()
    @IsEnum(PenaltyActionEnum)
    overridePenaltyAction?: PenaltyActionEnum;

    @IsOptional()
    @IsInt()
    @Min(1)
    overridePenaltyDurationDays?: number;

    @IsOptional()
    resetAvatar?: boolean;

    @IsOptional()
    resetBio?: boolean;

    @IsOptional()
    resetName?: boolean;
}
