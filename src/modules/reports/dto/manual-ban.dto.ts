import { IsInt, IsNotEmpty, Min } from 'class-validator';
import { AdminActionWithPasswordDto } from '@/modules/users/dto/update-user.dto';

export class ManualBanDto extends AdminActionWithPasswordDto {
    @IsNotEmpty()
    @IsInt()
    @Min(1)
    durationDays: number; // Có thể dùng số lớn như 36500 cho ban vĩnh viễn
}
