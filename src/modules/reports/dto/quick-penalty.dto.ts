import { IsBoolean, IsOptional } from 'class-validator';
import { AdminActionReasonDto } from '@/modules/users/dto/update-user.dto';

export class QuickPenaltyDto extends AdminActionReasonDto {
    @IsOptional()
    @IsBoolean()
    resetAvatar?: boolean;

    @IsOptional()
    @IsBoolean()
    resetBio?: boolean;

    @IsOptional()
    @IsBoolean()
    resetName?: boolean;
}
