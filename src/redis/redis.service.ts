import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
    constructor(private configService: ConfigService) {}

    private readonly redis = new Redis({
        host: this.configService.get('REDIS_HOST') || '127.0.0.1',
        port: this.configService.get('REDIS_PORT') || 6379,
        password: this.configService.get('REDIS_PASSWORD') || undefined,
    });

    async setWithTTL(key: string, value: string, ttlSeconds: number) {
        await this.redis.set(key, value, 'EX', ttlSeconds);
    }

    async get(key: string) {
        return this.redis.get(key);
    }

    async del(key: string) {
        return this.redis.del(key);
    }

    async ttl(key: string) {
        return this.redis.ttl(key);
    }

    async onModuleDestroy() {
        await this.redis.quit();
    }
}
