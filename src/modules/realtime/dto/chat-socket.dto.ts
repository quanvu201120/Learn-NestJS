import { IsMongoId, IsNotEmpty } from 'class-validator';

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
