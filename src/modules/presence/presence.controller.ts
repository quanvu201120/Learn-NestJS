import { Body, Controller, Post } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { GetUserOnlineBodyDto } from './dto/presence.dto';

@Controller('presence')
export class PresenceController {
    constructor(private readonly presenceService: PresenceService) {}

    @Post('users-online')
    getUsersOnline(@Body() body: GetUserOnlineBodyDto) {
        return this.presenceService.getUserOnline(body.userIds);
    }
}
