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
import { UpdateConversationDto } from './dto/update-conversation.dto';

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
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
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

    @Delete(':id/delete-history')
    deleteHistory(@Param('id') id: string, @Request() req) {
        return this.conversationsService.deleteHistory(id, req.user._id);
    }
}
