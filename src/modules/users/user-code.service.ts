import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ms, { StringValue } from 'ms';
import { RedisService } from '@/redis/redis.service';
import { ActionRedis } from '@/common/constants/global.constant';
import { hashCodeVerifyEmail } from '@/utils/utils';
import { USER_MESSAGES } from './constants/user.constant';

@Injectable()
export class UserCodeService {
    constructor(
        private readonly configService: ConfigService,
        private readonly redisService: RedisService,
    ) {}

    redisActiveKey(userId: string) {
        return `auth:active:${userId}`;
    }

    redisForgotKey(userId: string) {
        return `auth:forgot:${userId}`;
    }

    redisUpdateEmailKey(userId: string, email: string) {
        return `auth:update-email:${userId}:${email}`;
    }

    /**
     * Hàm helper: Kiểm tra mã OTP gửi lên so với mã OTP đã hash lưu trong Redis.
     */
    async verifyCodeWithRedis(keyRedis: string, code: string) {
        const redisCodeActive = await this.redisService.get(keyRedis);

        if (!redisCodeActive) {
            throw new BadRequestException(USER_MESSAGES.CODE_EXPIRED);
        }

        const hashCode = hashCodeVerifyEmail(
            code,
            this.configService.get<string>('CODE_VERIFY_PEPPER')!,
        );

        if (hashCode !== redisCodeActive) {
            throw new BadRequestException(USER_MESSAGES.INVALID_CODE);
        }

        await this.redisService.del(keyRedis);
    }

    async checkMailCooldownRedis(
        keyRedis: string,
        rawExpire: string,
        cooldownSeconds: number,
    ) {
        const ttlSeconds = await this.redisService.ttl(keyRedis);

        if (ttlSeconds < 0) return;

        const expireSeconds = ms(rawExpire as StringValue) / 1000;
        const elapsedSeconds = expireSeconds - ttlSeconds;

        if (elapsedSeconds < cooldownSeconds) {
            const waitTime = Math.ceil(cooldownSeconds - elapsedSeconds);
            throw new BadRequestException(
                USER_MESSAGES.PLEASE_WAIT_COOLDOWN(waitTime),
            );
        }
    }

    async saveCodeRedis(
        id: string,
        codeActive: string,
        type: ActionRedis,
        email: string = '',
    ) {
        const keyRedis =
            type === 'FORGOT'
                ? this.redisForgotKey(id)
                : type === 'UPDATE_EMAIL'
                  ? this.redisUpdateEmailKey(id, email)
                  : this.redisActiveKey(id);
        const expireTime = this.configService.get<string>(
            type === 'FORGOT'
                ? 'MAIL_CODE_FORGOT_EXPIRE'
                : type === 'UPDATE_EMAIL'
                  ? 'MAIL_CODE_UPDATE_EMAIL_EXPIRE'
                  : 'MAIL_CODE_ACTIVE_EXPIRE',
        )!;
        const expireTimeSeconds = ms(expireTime as StringValue) / 1000;
        const hashCode = hashCodeVerifyEmail(
            codeActive,
            this.configService.get<string>('CODE_VERIFY_PEPPER')!,
        );
        await this.redisService.setWithTTL(
            keyRedis,
            hashCode,
            expireTimeSeconds,
        );
    }
}
