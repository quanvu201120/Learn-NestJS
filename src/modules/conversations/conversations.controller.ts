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
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import {
    AddMembersConversationDto,
    RemoveMemberConversationDto,
    UpdateNameConversationDto,
} from './dto/update-conversation.dto';

@Controller('conversations')
export class ConversationsController {
    constructor(private readonly conversationsService: ConversationsService) {}

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
    findAllByUser(@Request() req) {
        return this.conversationsService.findAllByUser(req.user._id);
    }

    @Get(':id')
    findOne(@Param('id') id: string, @Request() req: any) {
        return this.conversationsService.findOne(id, req.user._id);
    }

    @Patch(':id/update-name-conversation')
    updateNameConversation(
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

    @Delete(':id/delete-history')
    deleteHistory(@Param('id') id: string, @Request() req) {
        return this.conversationsService.deleteHistory(id, req.user._id);
    }
}
