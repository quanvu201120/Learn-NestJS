/* eslint-disable no-useless-catch */
import {
    GLOBAL_MESSAGES,
    GLOBAL_CONSTANTS,
} from '@/common/constants/global.constant';
import { PayloadJWT } from '@/modules/users/schemas/user.schema';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import ms, { StringValue } from 'ms';

/**
 * Mã hóa (hash) mật khẩu người dùng bằng bcrypt.
 */
export const hashPassword = async (password: string): Promise<string> => {
    return await bcrypt.hash(password, GLOBAL_CONSTANTS.SALT_BCRYPT);
};

/**
 * Hàm nội bộ: Mã hóa một chuỗi bằng SHA256 kèm theo một chuỗi "pepper" để tăng cường bảo mật.
 */
const hashValue = (value: string, pepper: string) =>
    createHash('sha256').update(`${value}${pepper}`).digest('hex');

/**
 * Mã hóa refresh token trước khi lưu vào database.
 */
export const hashRefreshToken = (token: string, pepper: string) =>
    hashValue(token, pepper);

/**
 * Mã hóa mã OTP xác thực email trước khi lưu vào Redis.
 */
export const hashCodeVerifyEmail = (code: string, pepper: string) =>
    hashValue(code, pepper);

/**
 * Kiểm tra xem một chuỗi có phải là MongoDB ObjectId hợp lệ hay không. Ném lỗi nếu không hợp lệ.
 */
export const validateObjectId = (id: string, fieldName: string): void => {
    if (!Types.ObjectId.isValid(id)) {
        throw new BadRequestException(GLOBAL_MESSAGES.INVALID_FIELD(fieldName));
    }
};

/**
 * Chuyển đổi chuỗi thành MongoDB ObjectId. Tự động kiểm tra tính hợp lệ trước khi chuyển đổi.
 */
export const toObjectId = (id: string, fieldName: string): Types.ObjectId => {
    validateObjectId(id, fieldName);
    return new Types.ObjectId(id);
};

/**
 * Chuyển chuỗi thành đối tượng Date. Ném lỗi BadRequest nếu chuỗi ngày tháng không hợp lệ.
 */
export const parseDateOrThrow = (value: string, fieldName: string): Date => {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new BadRequestException(GLOBAL_MESSAGES.INVALID_FIELD(fieldName));
    }

    return date;
};

/**
 * Ký và tạo cặp Access Token (AT) và Refresh Token (RT) cho User khi đăng nhập.
 */
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

/**
 * Format chuỗi thời gian (ví dụ "15m", "1d") thành định dạng tiếng Việt thân thiện ("15 phút", "1 ngày").
 */
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

/**
 * Phân tích User-Agent để suy ra loại trình duyệt và hệ điều hành của thiết bị đăng nhập.
 */
export function buildDeviceNameFromUA(userAgent?: string): string {
    if (!userAgent || userAgent.trim().length === 0) {
        return GLOBAL_MESSAGES.UNKNOWN_DEVICE;
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

    if (!browser && !os) return GLOBAL_MESSAGES.UNKNOWN_DEVICE;
    if (browser && os) return `${browser} trên ${os}`;
    return browser || os || GLOBAL_MESSAGES.UNKNOWN_DEVICE;
}

/**
 * Tạo format tên Room Socket.IO cho một Conversation.
 */
export const getRoomNameConversation = (conversationId: string) => {
    try {
        toObjectId(conversationId, 'conversationId');
        return `conversation:${conversationId}`;
    } catch (error) {
        throw error;
    }
};

/**
 * Tạo format tên Room Socket.IO cho một User cá nhân (dùng để gửi sự kiện riêng).
 */
export const getRoomNameUser = (userId: string) => {
    try {
        toObjectId(userId, 'userId');
        return `user:${userId}`;
    } catch (error) {
        throw error;
    }
};
