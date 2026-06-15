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
    UseInterceptors,
    UploadedFile,
    ParseFilePipe,
    FileTypeValidator,
    MaxFileSizeValidator,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import {
    CreateMediaMessageDto,
    CreateTextMessageDto,
} from './dto/create-message.dto';
import { RemoveReactionDto, UpsertReactionDto } from './dto/update-message.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { MessageEnumType } from './types/message';

@Controller()
export class MessagesController {
    constructor(private readonly messagesService: MessagesService) {}

    @Post('conversations/:conversationId/message/text')
    async sendMessage(
        @Param('conversationId') conversationId: string,
        @Body() createTextMessageDto: CreateTextMessageDto,
        @Request() req,
    ) {
        const { message } = await this.messagesService.createMessage(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            req.user._id.toString(),
            conversationId,
            MessageEnumType.TEXT,
            createTextMessageDto.content,
            createTextMessageDto.replyTo,
        );
        return message;
    }
    @Post('conversations/:conversationId/message/image')
    @UseInterceptors(FileInterceptor('file'))
    async sendImageMessage(
        @Param('conversationId') conversationId: string,
        @UploadedFile(
            new ParseFilePipe({
                validators: [
                    new FileTypeValidator({ fileType: 'image/*' }),
                    new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }),
                ],
            }),
        )
        file: Express.Multer.File,
        @Body() createMediaMessageDto: CreateMediaMessageDto,
        @Request() req,
    ) {
        const { message } = await this.messagesService.createMessage(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            req.user._id.toString(),
            conversationId,
            MessageEnumType.IMAGE,
            undefined,
            createMediaMessageDto.replyTo,
            file,
        );
        return message;
    }
    @Post('conversations/:conversationId/message/video')
    @UseInterceptors(FileInterceptor('file'))
    async sendVideoMessage(
        @Param('conversationId') conversationId: string,
        @UploadedFile(
            new ParseFilePipe({
                validators: [
                    new FileTypeValidator({
                        fileType: /(video\/mp4|video\/webm|video\/quicktime)$/,
                    }),
                    new MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 }),
                ],
            }),
        )
        file: Express.Multer.File,
        @Body() createMediaMessageDto: CreateMediaMessageDto,
        @Request() req,
    ) {
        const { message } = await this.messagesService.createMessage(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            req.user._id.toString(),
            conversationId,
            MessageEnumType.VIDEO,
            undefined,
            createMediaMessageDto.replyTo,
            file,
        );
        return message;
    }
    @Post('conversations/:conversationId/message/file')
    @UseInterceptors(FileInterceptor('file'))
    async sendFileMessage(
        @Param('conversationId') conversationId: string,
        @UploadedFile(
            new ParseFilePipe({
                validators: [
                    new FileTypeValidator({
                        fileType:
                            /(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-powerpoint|application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation|text\/plain|text\/csv|application\/zip|application\/x-zip-compressed|application\/x-rar-compressed|application\/vnd\.rar)$/,
                    }),
                    new MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 }),
                ],
            }),
        )
        file: Express.Multer.File,
        @Body() createMediaMessageDto: CreateMediaMessageDto,
        @Request() req,
    ) {
        const { message } = await this.messagesService.createMessage(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            req.user._id.toString(),
            conversationId,
            MessageEnumType.FILE,
            undefined,
            createMediaMessageDto.replyTo,
            file,
        );
        return message;
    }

    @Post('conversations/:conversationId/message/voice')
    @UseInterceptors(FileInterceptor('file'))
    async sendVoiceMessage(
        @Param('conversationId') conversationId: string,
        @UploadedFile(
            new ParseFilePipe({
                validators: [
                    new FileTypeValidator({
                        fileType:
                            /^(audio\/(webm|ogg|wav|x-wav|mpeg|mp4|aac)|video\/webm)(;.*)?$/i,
                        fallbackToMimetype: true,
                    }),
                    new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }),
                ],
            }),
        )
        file: Express.Multer.File,
        @Body() createMediaMessageDto: CreateMediaMessageDto,
        @Request() req,
    ) {
        const { message } = await this.messagesService.createMessage(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            req.user._id.toString(),
            conversationId,
            MessageEnumType.VOICE,
            undefined,
            createMediaMessageDto.replyTo,
            file,
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
