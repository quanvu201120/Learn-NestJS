import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
    SystemDailyStat,
    SystemDailyStatDocument,
} from './schemas/system-daily-stat.schema';
import { RedisService } from '@/redis/redis.service';
import { CloudinaryService } from '@/modules/media/providers/cloudinary.service';
import { R2Service } from '@/modules/media/providers/r2.service';

@Injectable()
export class StatsHealthService {
    constructor(
        @InjectModel(SystemDailyStat.name)
        private readonly dailyStatModel: Model<SystemDailyStatDocument>,
        @Inject(forwardRef(() => RedisService))
        private readonly redisService: RedisService,
        private readonly cloudinaryService: CloudinaryService,
        private readonly r2Service: R2Service,
    ) {}

    async getSystemHealth() {
        const measure = async (promise: Promise<unknown>) => {
            const start = Date.now();
            try {
                const res = await promise;
                if (res === false) return { status: false, ping: 0 };
                return { status: true, ping: Date.now() - start };
            } catch {
                return { status: false, ping: 0 };
            }
        };

        const [mongoHealth, redisHealth, cloudinaryHealth, r2Health] =
            await Promise.all([
                measure(
                    this.dailyStatModel.db.db
                        ? this.dailyStatModel.db.db.command({ ping: 1 })
                        : Promise.resolve(false),
                ),
                measure(this.redisService.ping()),
                measure(this.cloudinaryService.ping()),
                measure(this.r2Service.ping()),
            ]);

        return {
            uptimeSeconds: process.uptime(),
            services: {
                mongodb: mongoHealth,
                redis: redisHealth,
                cloudinary: cloudinaryHealth,
                r2: r2Health,
            },
        };
    }
}
