import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CallService } from '../call.service';

@Injectable()
export class CallMessageReconcileCron {
    constructor(private readonly callService: CallService) {}

    @Cron('0 0 1 * * *')
    async createMissingCallMessages() {
        await this.callService.createMissingCallMessages();
    }
}
