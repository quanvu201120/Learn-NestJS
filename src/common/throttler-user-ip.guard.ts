/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
    InjectThrottlerOptions,
    InjectThrottlerStorage,
    ThrottlerGuard,
    ThrottlerLimitDetail,
    ThrottlerStorage,
} from '@nestjs/throttler';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { ReportsService } from '@/modules/reports/reports.service';

@Injectable()
export class ThrottlerUserIpGuard extends ThrottlerGuard {
    constructor(
        @InjectThrottlerOptions()
        options: ThrottlerModuleOptions,
        @InjectThrottlerStorage()
        storageService: ThrottlerStorage,
        reflector: Reflector,
        private readonly reportsService: ReportsService,
    ) {
        super(options, storageService, reflector);
    }

    protected getTracker(req: Record<string, any>): Promise<string> {
        const userId = req.user?._id?.toString?.();
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';

        if (userId) {
            return Promise.resolve(`${userId}:${ip}`);
        }

        return Promise.resolve(ip);
    }

    protected async throwThrottlingException(
        context: ExecutionContext,
        throttlerLimitDetail: ThrottlerLimitDetail,
    ): Promise<void> {
        const { req } = this.getRequestResponse(context);
        const userId = req.user?._id?.toString?.();

        if (userId) {
            await this.reportsService.recordRateLimitViolation(userId, req);
        }

        await super.throwThrottlingException(context, throttlerLimitDetail);
    }
}
