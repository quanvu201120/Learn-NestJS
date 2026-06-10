/* eslint-disable @typescript-eslint/no-unused-vars */
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

    /**
     * Khởi tạo: Cấu hình Redis nhận sự kiện hết hạn key (Keyspace Notifications)
     * và lắng nghe các key hết hạn để trigger sự kiện Offline hoặc Ngừng gõ phím.
     */
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

    /**
     * Dọn dẹp kết nối Redis khi module bị hủy (App tắt).
     */
    async onModuleDestroy() {
        await this.redis.quit();
        await this.subscriber.quit();
    }

    /**
     * Lưu một cặp Key-Value vào Redis với thời gian sống (TTL) tính bằng giây.
     */
    async setWithTTL(key: string, value: string, ttlSeconds: number) {
        await this.redis.set(key, value, 'EX', ttlSeconds);
    }

    /**
     * Lấy giá trị của một Key từ Redis.
     */
    async get(key: string) {
        return this.redis.get(key);
    }

    /**
     * Xóa một Key khỏi Redis.
     */
    async del(key: string) {
        return this.redis.del(key);
    }

    /**
     * Lấy thời gian sống còn lại (TTL) của một Key (tính bằng giây).
     */
    async ttl(key: string) {
        return this.redis.ttl(key);
    }

    /**
     * Set trạng thái Online cho user bằng cách gán key `presence:user:{id}` với TTL = 120s.
     * Cần được gọi lại liên tục (Heartbeat) để duy trì online.
     */
    setPresence(userId: string) {
        return this.setWithTTL(`presence:user:${userId}`, 'online', 120);
    }

    /**
     * Kiểm tra xem user có đang Online hay không.
     */
    getPresence(userId: string) {
        return this.redis.get(`presence:user:${userId}`);
    }

    /**
     * Đánh dấu có tin nhắn mới (Unseen) cho danh sách user đang online.
     * Thêm conversationId vào Set `unseen:conversations:{userId}` của từng user.
     */
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

    /**
     * Gỡ bỏ cờ Unseen của một conversation cho một user (khi user đã đọc tin nhắn).
     */
    async removeUnseenConversation(userId: string, conversationId: string) {
        return await this.redis.srem(
            `unseen:conversations:${userId}`,
            conversationId,
        );
    }

    /**
     * Xóa toàn bộ cờ Unseen của một conversation cho tất cả user (khi user đã đọc tin nhắn).
     */
    async removeAllUnseenConversation(
        userIds: (string | Types.ObjectId)[],
        conversationId: string,
    ) {
        const pipeline = this.redis.pipeline();
        userIds.forEach((userId) => {
            pipeline.srem(
                `unseen:conversations:${userId.toString()}`,
                conversationId,
            );
        });
        const result = await pipeline.exec();
        if (!result) {
            return {
                ok: false,
                failedCount: userIds.length,
            };
        }
        const failed = result
            .map(([error, _], index) => ({
                error,
                userId: userIds[index]?.toString(),
            }))
            .filter((item) => item.error);

        return {
            ok: failed.length === 0,
            failedCount: failed.length,
        };
    }

    /**
     * Set cờ đang gõ phím (Typing) cho một user trong conversation với TTL = 4s.
     * Sử dụng NX để chỉ set nếu key chưa tồn tại. Trả về 'new' nếu mới set, 'refreshed' nếu gia hạn.
     */
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

    /**
     * Gia hạn cờ Typing. Sử dụng XX để chỉ set nếu key đã tồn tại.
     */
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

    /**
     * Gỡ bỏ cờ Typing ngay lập tức (khi user ngưng gõ hoặc xóa sạch textbox).
     */
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

    /**
     * Đếm số lượng thiết bị (socket) mà user đang gõ phím trong cùng 1 conversation.
     * Sử dụng SCAN để đếm tất cả key match pattern.
     */
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

    /**
     * Kiểm tra xem user có đang gõ phím trên bất kỳ thiết bị nào trong conversation không.
     */
    async hasTypingConversation(userId: string, conversationId: string) {
        const count = await this.countTypingConversations(
            userId,
            conversationId,
        );
        return count > 0;
    }

    /**
     * Lọc ra danh sách các userId đang Online từ mảng các userId truyền vào.
     * Chạy mget một lần cho hiệu suất cao.
     */
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
