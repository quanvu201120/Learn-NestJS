/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class ThrottlerUserIpGuard extends ThrottlerGuard {
    protected getTracker(req: Record<string, any>): Promise<string> {
        const userId = req.user?._id?.toString?.();
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';

        if (userId) {
            return Promise.resolve(`${userId}:${ip}`);
        }

        return Promise.resolve(ip);
    }
}
