import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { UserRole } from '../types/user';
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';

export class GetUsersDto {
    @IsOptional()
    @IsString()
    query?: string;

    @IsOptional()
    @IsIn(['active', 'banned', 'unverified', 'suspended'])
    status?: string;

    @IsOptional()
    @IsIn([UserRole.USER, UserRole.ADMIN, UserRole.SUPER_ADMIN])
    role?: UserRole;

    @IsOptional()
    @IsIn(['name_asc', 'name_desc'])
    sort?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    current?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(GLOBAL_CONSTANTS.LIMIT_USERS_MAX)
    pageSize?: number;
}
