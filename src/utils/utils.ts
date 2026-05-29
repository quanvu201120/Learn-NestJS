import { PayloadJWT } from '@/modules/users/schemas/user.schema';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { BadRequestException } from '@nestjs/common';
import ms, { StringValue } from 'ms';
import { createHash } from 'crypto';

const saltBcypt = 10;

export const hashPassword = async (password: string): Promise<string> => {
    return await bcrypt.hash(password, saltBcypt);
};

const hashValue = (value: string, pepper: string) =>
    createHash('sha256').update(`${value}${pepper}`).digest('hex');

export const hashRefreshToken = (token: string, pepper: string) =>
    hashValue(token, pepper);

export const generateJWT = async (
    payload: { _id: string; role: string },
    configService: ConfigService,
    jwtService: JwtService,
) => {
    const newPayload: PayloadJWT = { _id: payload._id, role: payload.role };
    const accessToken = await jwtService.signAsync(newPayload);
    const refreshToken = await jwtService.signAsync(newPayload, {
        secret: configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: configService.get<StringValue>('JWT_REFRESH_EXPIRES_IN_DB'),
    });
    return { accessToken, refreshToken };
};

export const formatExpireTime = (expireTime: string): string => {
    if (!expireTime) return '';
    const num = parseInt(expireTime, 10);
    const unit = expireTime.replace(String(num), '').trim().toLowerCase();

    switch (unit) {
        case 's':
        case 'sec':
        case 'second':
        case 'seconds':
            return `${num} giây`;
        case 'm':
        case 'min':
        case 'minute':
        case 'minutes':
            return `${num} phút`;
        case 'h':
        case 'hr':
        case 'hour':
        case 'hours':
            return `${num} giờ`;
        case 'd':
        case 'day':
        case 'days':
            return `${num} ngày`;
        default:
            return expireTime;
    }
};

export const checkMailCooldown = (
    expiredAt: Date | undefined | null,
    expireDurationStr: string,
    cooldownSeconds = 60,
): void => {
    if (!expiredAt || !expireDurationStr) return;

    // Tính thời điểm gửi mail gần nhất = Thời điểm hết hạn - Thời gian sống của code
    const expireMs = ms(expireDurationStr as StringValue);
    const lastSentTime = expiredAt.getTime() - expireMs;

    // Khoảng cách thời gian so với hiện tại (tính bằng giây)
    const timeDifference = (Date.now() - lastSentTime) / 1000;

    if (timeDifference < cooldownSeconds) {
        const waitTime = Math.ceil(cooldownSeconds - timeDifference);
        throw new BadRequestException(
            `Vui lòng đợi ${waitTime} giây trước khi yêu cầu gửi lại mã mới.`,
        );
    }
};
