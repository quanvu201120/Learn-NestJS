/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    Request,
    UseInterceptors,
    UploadedFile,
    ParseFilePipe,
    FileTypeValidator,
    MaxFileSizeValidator,
    Query,
    ParseEnumPipe,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import {
    AddMembersConversationDto,
    ChangeAdminGroupDto,
    ReadMessageDto,
    RemoveMemberConversationDto,
    UpdateNameConversationDto,
} from './dto/update-conversation.dto';
import { RedisService } from '@/redis/redis.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaResourceTypeEnum } from '../media/types/media';
import { MediaService } from '../media/media.service';

@Controller('conversations')
export class ConversationsController {
    constructor(
        private readonly conversationsService: ConversationsService,
        private readonly redisService: RedisService,
        private readonly mediaService: MediaService,
    ) {}

    @Post()
    create(
        @Body() createConversationDto: CreateConversationDto,
        @Request() req,
    ) {
        return this.conversationsService.createConversation(
            createConversationDto,
            req.user._id,
        );
    }

    @Get()
    findAllByUser(@Request() req, @Query('cursor') cursor?: string) {
        return this.conversationsService.findAllByUser(req.user._id, cursor);
    }

    @Get(':id')
    findOne(@Param('id') id: string, @Request() req: any) {
        return this.conversationsService.findOne(id, req.user._id);
    }

    @Get(':id/medias')
    getMedias(
        @Request() req,
        @Param('id') id: string,
        @Query('type', new ParseEnumPipe(MediaResourceTypeEnum))
        type: MediaResourceTypeEnum,
        @Query('cursor') cursor?: string,
    ) {
        return this.mediaService.getMediasByConversation(
            id,
            req.user._id,
            type,
            cursor,
        );
    }

    @Patch(':id/update-name')
    updateName(
        @Param('id') id: string,
        @Body() updateNameConversationDto: UpdateNameConversationDto,
        @Request() req: any,
    ) {
        return this.conversationsService.updateNameConversation(
            id,
            req.user._id,
            updateNameConversationDto.name,
        );
    }

    @Patch(':id/add-members')
    addMembers(
        @Param('id') id: string,
        @Body() addMembersConversationDto: AddMembersConversationDto,
        @Request() req: any,
    ) {
        return this.conversationsService.addMembers(
            id,
            req.user._id,
            addMembersConversationDto.members,
        );
    }

    @Patch(':id/remove-member')
    removeMember(
        @Param('id') id: string,
        @Body() removeMemberConversationDto: RemoveMemberConversationDto,
        @Request() req: any,
    ) {
        return this.conversationsService.removeMember(
            id,
            req.user._id,
            removeMemberConversationDto.memberId,
        );
    }

    @Delete(':id/leave-group')
    leaveGroup(@Param('id') id: string, @Request() req: any) {
        return this.conversationsService.removeMember(
            id,
            req.user._id,
            req.user._id,
        );
    }

    @Delete(':id/disband-group')
    disbandGroup(@Param('id') id: string, @Request() req: any) {
        return this.conversationsService.disbandGroup(id, req.user._id);
    }

    @Patch(':id/read')
    async markAsRead(
        @Param('id') id: string,
        @Body() readMessageDto: ReadMessageDto,
        @Request() req: any,
    ) {
        const result = await this.conversationsService.markAsRead(
            id,
            req.user._id,
            readMessageDto.messageId,
        );
        await this.redisService.removeUnseenConversationWithCleanup(
            req.user._id,
            id,
        );
        return result;
    }

    @Patch(':id/change-admin')
    async changeAdmin(
        @Param('id') id: string,
        @Body() changeAdminGroupDto: ChangeAdminGroupDto,
        @Request() req: any,
    ) {
        return await this.conversationsService.changeAdminGroup(
            req.user._id,
            changeAdminGroupDto.newAdminId,
            id,
        );
    }

    @Delete(':id/block-and-delete')
    blockAndDelete(@Param('id') id: string, @Request() req) {
        return this.conversationsService.blockAndDelete(id, req.user._id);
    }

    @Delete(':id')
    hiddenHistory(@Param('id') id: string, @Request() req) {
        return this.conversationsService.hiddenHistory(id, req.user._id);
    }

    @Patch(':id/avatar')
    @UseInterceptors(FileInterceptor('file'))
    uploadAvatar(
        @Param('id') id: string,
        @UploadedFile(
            new ParseFilePipe({
                validators: [
                    new FileTypeValidator({ fileType: 'image/*' }),
                    new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
                ],
            }),
        )
        file: Express.Multer.File,
        @Request() req,
    ) {
        return this.conversationsService.uploadAvatar(id, req.user._id, file);
    }

    @Delete(':id/avatar')
    deleteAvatar(@Param('id') id: string, @Request() req: any) {
        return this.conversationsService.deleteAvatar(id, req.user._id);
    }

    @Patch(':id/accept')
    acceptConversation(@Param('id') id: string, @Request() req: any) {
        return this.conversationsService.acceptConversation(id, req.user._id);
    }
}
