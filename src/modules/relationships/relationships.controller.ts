/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Request,
} from '@nestjs/common';
import { RelationshipsService } from './relationships.service';
import { CreateRelationshipDto } from './dto/create-relationship.dto';
import { TargetUserRelationshipDto } from './dto/update-relationship.dto';

@Controller('relationships')
export class RelationshipsController {
    constructor(private readonly relationshipsService: RelationshipsService) {}

    @Get()
    async getRelationshipByUser(@Request() req) {
        return await this.relationshipsService.getRelationshipByUser(
            req.user._id,
        );
    }

    @Post()
    async create(
        @Body() createRelationshipDto: CreateRelationshipDto,
        @Request() req,
    ) {
        return await this.relationshipsService.create(
            createRelationshipDto,
            req.user._id,
        );
    }

    @Patch('block')
    async block(@Request() req, @Body() body: TargetUserRelationshipDto) {
        return await this.relationshipsService.blockUser(
            req.user._id,
            body.targetUserId,
        );
    }

    @Patch('unblock')
    async unblock(@Request() req, @Body() body: TargetUserRelationshipDto) {
        return await this.relationshipsService.unblockUser(
            req.user._id,
            body.targetUserId,
        );
    }

    @Patch(':id/accept')
    async accept(
        @Param('id') id: string,
        @Request() req,
        @Body() body: TargetUserRelationshipDto,
    ) {
        return await this.relationshipsService.accept(
            id,
            req.user._id,
            body.targetUserId,
        );
    }

    @Patch(':id/rejectOrRemove')
    async rejectOrRemove(
        @Param('id') id: string,
        @Request() req,
        @Body() body: TargetUserRelationshipDto,
    ) {
        return await this.relationshipsService.rejectOrRemove(
            id,
            req.user._id,
            body.targetUserId,
        );
    }

    @Patch(':id/unfriend')
    async unfriend(
        @Param('id') id: string,
        @Request() req,
        @Body() body: TargetUserRelationshipDto,
    ) {
        return await this.relationshipsService.unfriend(
            id,
            req.user._id,
            body.targetUserId,
        );
    }
}
