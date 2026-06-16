import { CleanupJobStatusEnum } from '../types/cleanup-job';
import {
    IsDate,
    IsEnum,
    IsNumber,
    IsOptional,
    IsString,
} from 'class-validator';

export class UpdateCleanupJobDto {
    @IsEnum(CleanupJobStatusEnum)
    status: CleanupJobStatusEnum;

    @IsDate()
    @IsOptional()
    nextRetryAt?: Date;

    @IsDate()
    @IsOptional()
    resolvedAt?: Date;

    @IsString()
    @IsOptional()
    error?: string;
}
