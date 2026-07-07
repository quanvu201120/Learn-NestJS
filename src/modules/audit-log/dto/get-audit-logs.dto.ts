import { Type } from 'class-transformer';
import {
    IsDate,
    IsEnum,
    IsMongoId,
    IsOptional,
    IsString,
} from 'class-validator';
import { UserRole } from '@/modules/users/types/user';
import {
    AuditLogActionEnum,
    AuditLogTargetEnum,
} from '../types/audit-log.type';

export class GetAuditLogsDto {
    @IsOptional()
    @IsMongoId()
    cursor?: string;

    @IsOptional()
    @IsMongoId()
    actorId?: string;

    @IsOptional()
    @IsMongoId()
    targetId?: string;

    @IsOptional()
    @IsEnum(AuditLogActionEnum)
    action?: AuditLogActionEnum;

    @IsOptional()
    @IsEnum(AuditLogTargetEnum)
    targetType?: AuditLogTargetEnum;

    @IsOptional()
    @IsEnum(UserRole)
    actorRole?: UserRole;

    @IsOptional()
    @IsString()
    ip?: string;

    @IsOptional()
    @Type(() => Date)
    @IsDate()
    startDate?: Date;

    @IsOptional()
    @Type(() => Date)
    @IsDate()
    endDate?: Date;
}
