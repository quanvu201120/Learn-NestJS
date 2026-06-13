import {
    IsEnum,
    IsMongoId,
    IsNotEmpty,
    IsOptional,
    IsString,
} from 'class-validator';
import { MediaProviderEnum } from '../types/media';

export class UploadAvatarDto {
    @IsMongoId()
    @IsNotEmpty()
    targetId: string;

    @IsEnum(MediaProviderEnum)
    @IsOptional()
    provider?: MediaProviderEnum;

    @IsString()
    @IsOptional()
    fileName?: string;
}
