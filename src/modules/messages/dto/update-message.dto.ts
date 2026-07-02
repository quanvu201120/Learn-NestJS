import { IsEnum, IsMongoId, IsNotEmpty, IsString } from 'class-validator';
import { MessageEnumType, MessageReactionEnumType } from '../types/message';

export class UpdateMessageDto {
    @IsEnum(MessageEnumType)
    type: MessageEnumType;

    @IsString()
    @IsNotEmpty()
    content: string;
}

export class UpsertReactionDto {
    @IsMongoId()
    conversationId: string;

    @IsEnum(MessageReactionEnumType)
    type: MessageReactionEnumType;
}

export class RemoveReactionDto {
    @IsMongoId()
    conversationId: string;
}
