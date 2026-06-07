import {
    Controller,
    Post,
    Body,
    Param,
    Request,
    Get,
    Query,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';

@Controller()
export class MessagesController {
    constructor(private readonly messagesService: MessagesService) {}

    @Post('conversations/:conversationId/send')
    sendMessage(
        @Param('conversationId') conversationId: string,
        @Body() createMessageDto: CreateMessageDto,
        @Request() req,
    ) {
        return this.messagesService.createMessage(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            req.user._id.toString(),
            conversationId,
            createMessageDto.type,
            createMessageDto.content,
            createMessageDto.replyTo,
        );
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
}
