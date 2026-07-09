/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
    IsEnum,
    IsMongoId,
    IsNotEmpty,
    IsOptional,
    IsString,
    MaxLength,
    ValidateIf,
} from 'class-validator';
import { ReportReasonEnum } from '../types/report.type';
import { VALIDATION_MESSAGES } from '@/common/constants/validation.constant';

export class CreateReportDto {
    @IsNotEmpty()
    @IsMongoId()
    targetUserId: string;

    @IsNotEmpty()
    @IsEnum(ReportReasonEnum)
    reason: ReportReasonEnum;

    @ValidateIf((o) => o.reason === ReportReasonEnum.OTHER)
    @IsNotEmpty({
        message: VALIDATION_MESSAGES.DESCRIPTION_REQUIRED_FOR_OTHER_REASON,
    })
    @IsString()
    @MaxLength(500)
    description?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    optionalDescription?: string; // Tùy chọn nếu reason không phải OTHER
}
