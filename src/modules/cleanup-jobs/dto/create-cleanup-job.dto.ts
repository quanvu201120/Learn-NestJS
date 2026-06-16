import {
    CleanupJobActionEnum,
    CleanupJobEntityEnum,
    CleanupJobResourceEnum,
    CleanupJobStatusEnum,
} from '../types/cleanup-job';
import { CleanupJobPayload } from '../schemas/cleanup-job.schema';
import {
    IsEnum,
    IsMongoId,
    IsObject,
    IsOptional,
    IsString,
} from 'class-validator';

export class CreateCleanupJobDto {
    @IsEnum(CleanupJobResourceEnum)
    resourceType: CleanupJobResourceEnum;

    @IsEnum(CleanupJobActionEnum)
    action: CleanupJobActionEnum;

    @IsMongoId()
    @IsOptional()
    entityId?: string;

    @IsEnum(CleanupJobEntityEnum)
    entityType: CleanupJobEntityEnum;

    @IsObject()
    payload: CleanupJobPayload;

    @IsString()
    @IsOptional()
    error?: string;
}
