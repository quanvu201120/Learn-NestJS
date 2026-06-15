import { Injectable } from '@nestjs/common';
import { RedisService } from '@/redis/redis.service';

@Injectable()
export class PresenceService {
    constructor(private readonly redisService: RedisService) {}

    /**
     * Trả về danh sách user id đang online trong tập id được truyền vào.
     */
    async getUserOnline(listIds: string[]) {
        return await this.redisService.getUserOnlineInListIds(listIds);
    }
}
