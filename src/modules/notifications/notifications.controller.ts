/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
    Controller,
    Get,
    Patch,
    Param,
    Query,
    Request,
    BadRequestException,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
    constructor(private readonly notificationsService: NotificationsService) {}

    @Get()
    async findAll(
        @Request() req,
        @Query('cursor') cursor?: string,
        @Query('limit') limit?: string,
    ) {
        return await this.notificationsService.findAll(
            req.user._id,
            cursor,
            Number(limit),
        );
    }

    @Get('unread-count')
    async unreadCount(@Request() req) {
        return await this.notificationsService.unreadCount(req.user._id);
    }

    @Patch(':id/read')
    async markRead(@Request() req, @Param('id') id: string) {
        const notification = await this.notificationsService.markRead(
            req.user._id,
            id,
        );

        if (!notification) {
            throw new BadRequestException('Không tìm thấy thông báo');
        }

        return {
            message: 'Đã đọc thông báo',
            notification,
        };
    }

    @Patch('read-all')
    async markAllRead(@Request() req) {
        return await this.notificationsService.markAllRead(req.user._id);
    }
}
