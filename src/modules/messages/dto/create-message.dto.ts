import {
    IsMongoId,
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
} from 'class-validator';

export class CreateTextMessageDto {
    @IsString()
    @MinLength(1)
    @MaxLength(2000)
    content: string;

    @IsMongoId()
    @IsOptional()
    replyTo?: string;
}
export class CreateMediaMessageDto {
    @IsMongoId()
    @IsOptional()
    replyTo?: string;
}

export class CreateMessageSocketDto {
    @IsMongoId()
    conversationId: string;

    @IsString()
    @MinLength(1)
    @MaxLength(2000)
    content: string;

    @IsMongoId()
    @IsOptional()
    replyTo?: string;
}
