import { PayloadJWT } from '@/modules/users/schemas/user.schema';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import ms, { StringValue } from 'ms';

const saltBcypt = 10;

export const hashPassword = async (password: string): Promise<string> => {
    return await bcrypt.hash(password, saltBcypt);
};

const hashValue = (value: string, pepper: string) =>
    createHash('sha256').update(`${value}${pepper}`).digest('hex');

export const hashRefreshToken = (token: string, pepper: string) =>
    hashValue(token, pepper);

export const hashCodeVerifyEmail = (code: string, pepper: string) =>
    hashValue(code, pepper);

export const validateObjectId = (id: string, fieldName: string): void => {
    if (!Types.ObjectId.isValid(id)) {
        throw new BadRequestException(`Invalid ${fieldName}`);
    }
};

export const toObjectId = (id: string, fieldName: string): Types.ObjectId => {
    validateObjectId(id, fieldName);
    return new Types.ObjectId(id);
};

export const parseDateOrThrow = (value: string, fieldName: string): Date => {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new BadRequestException(`Invalid ${fieldName}`);
    }

    return date;
};

export const generateJWT = async (
    payload: {
        _id: string;
        role: string;
        sessionId: string;
        tokenVersion: number;
    },
    configService: ConfigService,
    jwtService: JwtService,
) => {
    const newPayload: PayloadJWT = {
        _id: payload._id,
        role: payload.role,
        sessionId: payload.sessionId,
        tokenVersion: payload.tokenVersion,
    };
    const expiresIn = configService.get<StringValue>(
        'JWT_REFRESH_EXPIRES_IN_DB',
    )!;

    const accessToken = await jwtService.signAsync(newPayload);
    const refreshToken = await jwtService.signAsync(newPayload, {
        secret: configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn,
    });
    const expireDate = new Date(Date.now() + ms(expiresIn));
    return { accessToken, refreshToken, expireDate };
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

export function buildDeviceNameFromUA(userAgent?: string): string {
    if (!userAgent || userAgent.trim().length === 0) {
        return 'Thiết bị không xác định';
    }

    const ua = userAgent.toLowerCase();

    let browser = '';
    if (ua.includes('edg/')) browser = 'Edge';
    else if (ua.includes('chrome/') && !ua.includes('edg/')) browser = 'Chrome';
    else if (ua.includes('firefox/')) browser = 'Firefox';
    else if (ua.includes('safari/') && !ua.includes('chrome/'))
        browser = 'Safari';
    else if (ua.includes('opr/') || ua.includes('opera/')) browser = 'Opera';

    let os = '';
    if (ua.includes('windows')) os = 'Windows';
    else if (ua.includes('android')) os = 'Android';
    else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios'))
        os = 'iOS';
    else if (ua.includes('mac os x') || ua.includes('macintosh')) os = 'macOS';
    else if (ua.includes('linux')) os = 'Linux';

    if (!browser && !os) return 'Thiết bị không xác định';
    if (browser && os) return `${browser} trên ${os}`;
    return browser || os || 'Thiết bị không xác định';
}
