import {
    IsArray,
    IsBoolean,
    IsMongoId,
    IsOptional,
    IsString,
} from 'class-validator';

export class CreateConversationDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsBoolean()
    @IsOptional()
    isGroup?: boolean;

    @IsArray()
    @IsMongoId({ each: true })
    users: string[];
}
