/* eslint-disable @typescript-eslint/no-unused-vars */
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';
import {
    forwardRef,
    Inject,
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Types } from 'mongoose';
import { Subject } from 'rxjs';
import { CleanupJobsService } from '@/modules/cleanup-jobs/cleanup-jobs.service';
import { CreateCleanupJobDto } from '@/modules/cleanup-jobs/dto/create-cleanup-job.dto';
import {
    CleanupJobActionEnum,
    CleanupJobEntityEnum,
    CleanupJobResourceEnum,
} from '@/modules/cleanup-jobs/types/cleanup-job';
import { logCatch } from '@/utils/utils';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RedisService.name);

    constructor(
        private configService: ConfigService,
        @Inject(forwardRef(() => CleanupJobsService))
        private readonly cleanupJobsService: CleanupJobsService,
    ) {}

    public readonly userOffline$ = new Subject<string>();
    public readonly userTypingStop$ = new Subject<{
        userId: string;
        conversationId: string;
        socketId: string;
    }>();

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
     * Đặt key nếu chưa tồn tại, có TTL. Dùng cho lock ngắn hạn.
     */
    async setIfNotExistsWithTTL(
        key: string,
        value: string,
        ttlSeconds: number,
    ) {
        const result = await this.redis.set(key, value, 'EX', ttlSeconds, 'NX');
        return result === 'OK';
    }

    /**
     * Tăng giá trị số nguyên của một key, nếu key chưa có thì tạo mới với TTL.
     */

    async incrWithTTL(key: string, ttlSeconds: number) {
        const pipeline = this.redis.pipeline();
        pipeline.incr(key);
        pipeline.expire(key, ttlSeconds, 'NX');
        const result = await pipeline.exec();
        return Number(result?.[0]?.[1] ?? 0);
        /*
            [               // Kết quả của pipeline.exec() là một Array 2 chiều
                [null, 3],   // phần tử số 0 = kết quả của INCR -> 3 (số sau khi tăng)
                [null, 1],   // phần tử số 1 = kết quả của EXPIRE -> 1 (thành công)
            ]
        */
    }

    /**
     * Lấy thời gian sống còn lại (TTL) của một Key (tính bằng giây).
     */
    async ttl(key: string) {
        return this.redis.ttl(key);
    }

    /**
     * Lấy danh sách key theo pattern bằng SCAN để tránh block Redis.
     */
    async scanKeys(pattern: string): Promise<string[]> {
        return new Promise((resolve, reject) => {
            const keys: string[] = [];
            const stream = this.redis.scanStream({
                match: pattern,
                count: 100,
            });

            stream.on('data', (chunk: string[]) => {
                keys.push(...chunk);
            });

            stream.on('end', () => {
                resolve(keys);
            });

            stream.on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Set trạng thái Online cho user bằng cách gán key `presence:user:{id}` với TTL = 120s.
     * Cần được gọi lại liên tục (Heartbeat) để duy trì online.
     */
    async setPresence(userId: string) {
        return await this.setWithTTL(
            `presence:user:${userId}`,
            'online',
            GLOBAL_CONSTANTS.HEARTBEAT_INTERVAL,
        );
    }

    /**
     * Kiểm tra xem user có đang Online hay không.
     */
    async getPresence(userId: string) {
        return await this.redis.get(`presence:user:${userId}`);
    }

    /**
     * Lấy tổng số lượng user đang online trong toàn hệ thống.
     * Sử dụng lệnh SCAN để không làm block server Redis.
     */
    async countTotalOnlineUsers(): Promise<number> {
        return new Promise((resolve, reject) => {
            let count = 0;
            const stream = this.redis.scanStream({
                match: 'presence:user:*',
                count: 100,
            });

            stream.on('data', (keys: string[]) => {
                count += keys.length;
            });

            stream.on('end', () => {
                resolve(count);
            });

            stream.on('error', (err) => {
                reject(err);
            });
        });
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

    async removeUnseenConversationWithCleanup(
        userId: string,
        conversationId: string,
    ) {
        try {
            return await this.removeUnseenConversation(userId, conversationId);
        } catch (error) {
            await this.createCleanupJob({
                resourceType: CleanupJobResourceEnum.UNSEEN_CONVERSATION,
                action: CleanupJobActionEnum.REDIS_REMOVE_UNSEEN_ONE,
                entityType: CleanupJobEntityEnum.CONVERSATION,
                entityId: conversationId,
                payload: {
                    userId,
                    conversationId,
                },
                error: (error as Error).message,
            });
            return null;
        }
    }

    /**
     * Xóa toàn bộ cờ Unseen của một conversation cho tất cả user (khi user đã đọc tin nhắn).
     */
    async removeAllUnseenConversation(
        userIds: (string | Types.ObjectId)[],
        conversationId: string,
    ) {
        if (userIds.length === 0) {
            return {
                ok: true,
                failedCount: 0,
                failedUserIds: [],
            };
        }
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

    async removeAllUnseenConversationWithCleanup(
        userIds: (string | Types.ObjectId)[],
        conversationId: string,
    ) {
        try {
            return await this.removeAllUnseenConversation(
                userIds,
                conversationId,
            );
        } catch (error) {
            await this.createCleanupJob({
                resourceType: CleanupJobResourceEnum.UNSEEN_CONVERSATION,
                action: CleanupJobActionEnum.REDIS_REMOVE_UNSEEN_MANY,
                entityType: CleanupJobEntityEnum.CONVERSATION,
                entityId: conversationId,
                payload: {
                    userIds: userIds.map((userId) => userId.toString()),
                    conversationId,
                },
                error: (error as Error).message,
            });
            return null;
        }
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
            (userId) => `presence:user:${userId.toString()}`,
        );
        const results = await this.redis.mget(keys);
        return members.filter((_, index) => results[index]);
    }

    /**
     * Tạo Redis key theo từng socket để theo dõi trạng thái đang gõ phím.
     */
    private getTypingKey(
        conversationId: string,
        userId: string,
        socketId: string,
    ) {
        return `typing:conversation:${conversationId}:user:${userId}:socket:${socketId}`;
    }

    /**
     * Tạo pattern để scan toàn bộ typing key của một user trong một conversation.
     */
    private getTypingPattern(conversationId: string, userId: string) {
        return `typing:conversation:${conversationId}:user:${userId}:socket:*`;
    }

    private async createCleanupJob(createDto: CreateCleanupJobDto) {
        try {
            await this.cleanupJobsService.createCleanupJob(createDto);
        } catch (error) {
            logCatch(this.logger, 'Failed to create cleanup job', error);
        }
    }

    /**
     * Lấy thông số server Redis (memory, clients, uptime) cho Admin Dashboard.
     */
    async getInfo() {
        try {
            const info = await this.redis.info();
            const parse = (section: string): string | undefined =>
                info
                    .split('\n')
                    .find((l) => l.startsWith(`${section}:`))
                    ?.split(':')[1]
                    ?.trim();

            const usedMemoryBytes = Number(parse('used_memory')) || 0;
            // Lấy maxmemory (nếu có set) hoặc total_system_memory (RAM tổng của server)
            const maxMemory = Number(parse('maxmemory')) || 0;
            const systemMemory = Number(parse('total_system_memory')) || 0;

            // Lấy maxmemory từ .env (nếu có cấu hình, tính bằng MB)
            const envMaxMemoryMB =
                Number(this.configService.get('REDIS_MAX_MEMORY_MB')) || 0;
            const envMaxMemoryBytes = envMaxMemoryMB * 1024 * 1024;

            // Ưu tiên: maxmemory thật từ server > cấu hình env > tổng RAM máy chủ
            const totalMemoryBytes =
                maxMemory > 0
                    ? maxMemory
                    : envMaxMemoryBytes > 0
                      ? envMaxMemoryBytes
                      : systemMemory;

            return {
                usedMemory: parse('used_memory_human') ?? 'N/A',
                connectedClients: parse('connected_clients') ?? 'N/A',
                uptimeInSeconds: parse('uptime_in_seconds') ?? 'N/A',
                usedMemoryBytes,
                totalMemoryBytes,
            };
        } catch {
            return {
                usedMemory: 'N/A',
                connectedClients: 'N/A',
                uptimeInSeconds: 'N/A',
                usedMemoryBytes: 0,
                totalMemoryBytes: 0,
            };
        }
    }

    /**
     * Ping Redis server để kiểm tra kết nối (Health Check).
     */
    async ping(): Promise<boolean> {
        try {
            const res = await this.redis.ping();
            return res === 'PONG';
        } catch {
            return false;
        }
    }
}
