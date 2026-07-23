/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Post,
    Request,
} from '@nestjs/common';
import { PresenceService } from './presence.service';
import { GetUserOnlineBodyDto } from './dto/presence.dto';

@Controller('presence')
export class PresenceController {
    constructor(private readonly presenceService: PresenceService) {}

    @HttpCode(HttpStatus.OK)
    @Post('users-online')
    getUsersOnline(@Body() body: GetUserOnlineBodyDto, @Request() req: any) {
        return this.presenceService.getUserOnline(body.userIds, req.user._id);
    }
}
