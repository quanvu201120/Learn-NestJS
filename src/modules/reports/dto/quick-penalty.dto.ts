import { IsBoolean, IsOptional } from 'class-validator';
import { AdminActionWithPasswordDto } from '@/modules/users/dto/update-user.dto';

export class QuickPenaltyDto extends AdminActionWithPasswordDto {
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
