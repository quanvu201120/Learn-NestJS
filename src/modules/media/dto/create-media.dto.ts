import {
    IsEnum,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUrl,
} from 'class-validator';
import {
    MediaProviderEnum,
    MediaResourceTypeEnum,
} from '../types/media';

export class CreateMediaDto {
    @IsEnum(MediaProviderEnum)
    provider: MediaProviderEnum;

    @IsEnum(MediaResourceTypeEnum)
    resourceType: MediaResourceTypeEnum;

    @IsUrl()
    @IsNotEmpty()
    url: string;

    @IsString()
    @IsOptional()
    publicId?: string;

    @IsString()
    @IsOptional()
    objectKey?: string;

    @IsString()
    @IsOptional()
    fileName?: string;

    @IsString()
    @IsOptional()
    mimeType?: string;
}
