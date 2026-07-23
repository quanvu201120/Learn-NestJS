import {
    IsMongoId,
    IsNotEmpty,
    IsString,
    MaxLength,
    MinLength,
} from 'class-validator';

export class JoinConversationSocketDto {
    @IsNotEmpty()
    @IsMongoId()
    conversationId: string;
}

export class DeleteMessageSocketDto {
    @IsNotEmpty()
    @IsMongoId()
    conversationId: string;

    @IsNotEmpty()
    @IsMongoId()
    messageId: string;
}

export class MarkReadSocketDto {
    @IsNotEmpty()
    @IsMongoId()
    conversationId: string;

    @IsNotEmpty()
    @IsMongoId()
    messageId: string;
}

export class TypingSocketDto {
    @IsNotEmpty()
    @IsMongoId()
    conversationId: string;
}

export class UpdateMessageSocketDto {
    @IsNotEmpty()
    @IsMongoId()
    conversationId: string;

    @IsNotEmpty()
    @IsMongoId()
    messageId: string;

    @IsNotEmpty()
    @IsString()
    @MinLength(1)
    @MaxLength(2000)
    content: string;
}
