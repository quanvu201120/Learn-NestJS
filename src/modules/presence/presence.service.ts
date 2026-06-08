import { Injectable } from '@nestjs/common';
import { RedisService } from '@/redis/redis.service';

@Injectable()
export class PresenceService {
    constructor(private readonly redisService: RedisService) {}

    async getUserOnline(listIds: string[]) {
        return await this.redisService.getUserOnlineInListIds(listIds);
    }
}
