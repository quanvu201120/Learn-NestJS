import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Types } from 'mongoose';
import { Subject } from 'rxjs';
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    constructor(private configService: ConfigService) {}

    public readonly userOffline$ = new Subject<string>();
    public readonly userTypingStop$ = new Subject<{
        userId: string;
        conversationId: string;
        socketId: string;
    }>();

    private getTypingKey(
        conversationId: string,
        userId: string,
        socketId: string,
    ) {
        return `typing:conversation:${conversationId}:user:${userId}:socket:${socketId}`;
    }

    private getTypingPattern(conversationId: string, userId: string) {
        return `typing:conversation:${conversationId}:user:${userId}:socket:*`;
    }

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
            if (key.startsWith('typing:conversation:')) {
                const parts = key.split(':');
                const conversationId = parts[2];
                const userId = parts[4];
                const socketId = parts[6];
                this.userTypingStop$.next({ userId, conversationId, socketId });
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

    async setTypingConversation(
        userId: string,
        conversationId: string,
        socketId: string,
    ) {
        const result = await this.redis.set(
            this.getTypingKey(conversationId, userId, socketId),
            'Typing',
            'EX',
            4,
            'NX',
        );
        if (!result) {
            await this.refreshTypingConversation(
                userId,
                conversationId,
                socketId,
            );
            return 'refreshed';
        }
        return 'new';
    }

    async refreshTypingConversation(
        userId: string,
        conversationId: string,
        socketId: string,
    ) {
        return await this.redis.set(
            this.getTypingKey(conversationId, userId, socketId),
            'Typing',
            'EX',
            4,
            'XX',
        );
    }

    async removeTypingConversation(
        userId: string,
        conversationId: string,
        socketId: string,
    ) {
        const result = await this.redis.del(
            this.getTypingKey(conversationId, userId, socketId),
        );
        return result > 0;
    }

    async countTypingConversations(userId: string, conversationId: string) {
        let cursor = '0';
        const pattern = this.getTypingPattern(conversationId, userId);
        let count = 0;

        do {
            const [nextCursor, keys] = await this.redis.scan(
                cursor,
                'MATCH',
                pattern,
                'COUNT',
                20,
            );
            count += keys.length;
            cursor = nextCursor;
        } while (cursor !== '0');

        return count;
    }

    async hasTypingConversation(userId: string, conversationId: string) {
        const count = await this.countTypingConversations(
            userId,
            conversationId,
        );
        return count > 0;
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
