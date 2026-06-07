import {
    IsEnum,
    IsMongoId,
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
} from 'class-validator';
import { MessageEnumType } from '../schemas/message.schema';

export class CreateMessageDto {
    @IsEnum(MessageEnumType)
    type: MessageEnumType;

    @IsString()
    @MinLength(1)
    @MaxLength(2000)
    content: string;

    @IsMongoId()
    @IsOptional()
    replyTo?: string;
}
export class CreateMessageSocketDto {
    @IsMongoId()
    conversationId: string;

    @IsEnum(MessageEnumType)
    type: MessageEnumType;

    @IsString()
    @MinLength(1)
    @MaxLength(2000)
    content: string;

    @IsMongoId()
    @IsOptional()
    replyTo?: string;
}
