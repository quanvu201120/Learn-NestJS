/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
    Controller,
    Post,
    Body,
    Param,
    Request,
    Get,
    Query,
    Delete,
    Patch,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { RemoveReactionDto, UpsertReactionDto } from './dto/update-message.dto';

@Controller()
export class MessagesController {
    constructor(private readonly messagesService: MessagesService) {}

    @Post('conversations/:conversationId/send')
    async sendMessage(
        @Param('conversationId') conversationId: string,
        @Body() createMessageDto: CreateMessageDto,
        @Request() req,
    ) {
        const { message } = await this.messagesService.createMessage(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            req.user._id.toString(),
            conversationId,
            createMessageDto.type,
            createMessageDto.content,
            createMessageDto.replyTo,
        );
        return message;
    }

    @Get('conversations/:conversationId/latest-message')
    getLatestMessageOfConversation(
        @Param('conversationId') conversationId: string,
    ) {
        return this.messagesService.getLatestMessageOfConversation(
            conversationId,
        );
    }
    @Get('conversations/:conversationId/message')
    getMessageOfConversation(
        @Param('conversationId') conversationId: string,
        @Request() req,
        @Query('cursor') cursor?: string,
    ) {
        return this.messagesService.getMessagesByConversation(
            conversationId,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            req.user._id.toString(),
            cursor,
        );
    }

    @Patch('messages/:messageId/reaction')
    upsertReaction(
        @Param('messageId') messageId: string,
        @Body() upsertReactionDto: UpsertReactionDto,
        @Request() req,
    ) {
        return this.messagesService.updateOrInsertReaction(
            req.user._id,
            messageId,
            upsertReactionDto.conversationId,
            upsertReactionDto.type,
        );
    }

    @Delete('messages/:messageId/reaction')
    removeReaction(
        @Param('messageId') messageId: string,
        @Body() removeReactionDto: RemoveReactionDto,
        @Request() req,
    ) {
        return this.messagesService.removeReaction(
            req.user._id,
            messageId,
            removeReactionDto.conversationId,
        );
    }
}
