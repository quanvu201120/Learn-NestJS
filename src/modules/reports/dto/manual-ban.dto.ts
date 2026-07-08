import { IsInt, IsNotEmpty, Min, IsOptional, IsBoolean } from 'class-validator';
import { AdminActionWithPasswordDto } from '@/modules/users/dto/update-user.dto';

export class ManualBanDto extends AdminActionWithPasswordDto {
    @IsNotEmpty()
    @IsInt()
    @Min(1)
    durationDays: number; // Có thể dùng số lớn như 36500 cho ban vĩnh viễn

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
