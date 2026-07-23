import {
    IsArray,
    IsBoolean,
    IsMongoId,
    IsOptional,
    IsString,
    MaxLength,
} from 'class-validator';

export class CreateConversationDto {
    @IsString()
    @IsOptional()
    @MaxLength(50)
    name?: string;

    @IsBoolean()
    @IsOptional()
    isGroup?: boolean;

    @IsArray()
    @IsMongoId({ each: true })
    users: string[];
}
