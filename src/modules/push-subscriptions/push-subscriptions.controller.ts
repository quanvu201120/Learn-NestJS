/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
    Body,
    Controller,
    Delete,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Request,
} from '@nestjs/common';
import { UpsertPushSubscriptionDto } from './dto/upsert-push-subscription.dto';
import { PushSubscriptionsService } from './push-subscriptions.service';

@Controller('push/subscriptions')
export class PushSubscriptionsController {
    constructor(
        private readonly pushSubscriptionsService: PushSubscriptionsService,
    ) {}

    @Post()
    @HttpCode(HttpStatus.OK)
    async upsert(@Request() req, @Body() body: UpsertPushSubscriptionDto) {
        return await this.pushSubscriptionsService.upsert(req.user._id, body);
    }

    @Delete(':deviceId')
    @HttpCode(HttpStatus.OK)
    async removeByDeviceId(
        @Request() req,
        @Param('deviceId') deviceId: string,
    ) {
        return await this.pushSubscriptionsService.removeByDeviceId(
            req.user._id,
            deviceId,
        );
    }
}
