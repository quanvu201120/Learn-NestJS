import { IsMongoId, IsOptional } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { CreateConversationDto } from './create-conversation.dto';

export class UpdateConversationDto extends PartialType(CreateConversationDto) {
    @IsMongoId()
    @IsOptional()
    lastMessageId?: string;
}
