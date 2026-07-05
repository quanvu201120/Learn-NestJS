import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { GetUserOnlineBodyDto } from './dto/presence.dto';

@Controller('presence')
export class PresenceController {
    constructor(private readonly presenceService: PresenceService) {}

    @HttpCode(HttpStatus.OK)
    @Post('users-online')
    getUsersOnline(@Body() body: GetUserOnlineBodyDto) {
        return this.presenceService.getUserOnline(body.userIds);
    }
}
