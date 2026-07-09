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

export class CreateReportDto {
    @IsNotEmpty()
    @IsMongoId()
    targetUserId: string;

    @IsNotEmpty()
    @IsEnum(ReportReasonEnum)
    reason: ReportReasonEnum;

    @ValidateIf((o) => o.reason === ReportReasonEnum.OTHER)
    @IsNotEmpty({ message: 'Mô tả là bắt buộc khi chọn lý do Khác' })
    @IsString()
    @MaxLength(500)
    description?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    optionalDescription?: string; // Tùy chọn nếu reason không phải OTHER
}
