import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Types } from 'mongoose';
import { Subject } from 'rxjs';
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    constructor(private configService: ConfigService) {}

    public readonly userOffline$ = new Subject<string>();

    private readonly redis = new Redis({
        host: this.configService.get('REDIS_HOST') || '127.0.0.1',
        port: this.configService.get('REDIS_PORT') || 6379,
        password: this.configService.get('REDIS_PASSWORD') || undefined,
    });

    private readonly subscriber = new Redis({
        host: this.configService.get('REDIS_HOST') || '127.0.0.1',
        port: this.configService.get('REDIS_PORT') || 6379,
        password: this.configService.get('REDIS_PASSWORD') || undefined,
        enableReadyCheck: false,
    });

    async onModuleInit() {
        await this.redis.config('SET', 'notify-keyspace-events', 'Ex');
        await this.subscriber.subscribe('__keyevent@0__:expired');

        this.subscriber.on('message', (channel, key) => {
            if (key.startsWith('presence:user:')) {
                const userId = key.replace('presence:user:', '');
                this.userOffline$.next(userId);
            }
        });
    }

    async onModuleDestroy() {
        await this.redis.quit();
        await this.subscriber.quit();
    }

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

    setPresence(userId: string) {
        return this.setWithTTL(`presence:user:${userId}`, 'online', 120);
    }

    getPresence(userId: string) {
        return this.redis.get(`presence:user:${userId}`);
    }

    async setUnseenMessage(
        membersOnline: (Types.ObjectId | string)[],
        conversationId: string,
    ) {
        const pipeline = this.redis.pipeline();

        membersOnline.forEach((userId) => {
            pipeline.sadd(
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                `unseen:conversations:${userId.toString()}`,
                conversationId,
            );
        });
        return await pipeline.exec();
    }

    async removeUnseenConversation(userId: string, conversationId: string) {
        return await this.redis.srem(
            `unseen:conversations:${userId}`,
            conversationId,
        );
    }

    async getUserOnlineInListIds(members: (Types.ObjectId | string)[]) {
        if (!members || members.length === 0) {
            return [];
        }
        const keys = members.map(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            (userId) => `presence:user:${userId.toString()}`,
        );
        const results = await this.redis.mget(keys);
        return members.filter((_, index) => results[index]);
    }
}
