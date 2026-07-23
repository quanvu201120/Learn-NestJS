import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { AdminActionWithPasswordDto } from '@/modules/users/dto/update-user.dto';
import { ReportReasonEnum } from '../types/report.type';

export class QuickPenaltyDto extends AdminActionWithPasswordDto {
    @IsEnum(ReportReasonEnum)
    reason: ReportReasonEnum;

    @IsOptional()
    @IsBoolean()
    resetAvatar?: boolean;

    @IsOptional()
    @IsBoolean()
    resetBio?: boolean;

    @IsOptional()
    @IsBoolean()
    resetName?: boolean;

    @IsOptional()
    adminNote?: string;
}
