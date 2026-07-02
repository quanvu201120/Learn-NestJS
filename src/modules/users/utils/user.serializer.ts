/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Types } from 'mongoose';
import { serializeMedia } from '@/modules/media/utils/media.serializer';

/**
 * Chuẩn hóa thông tin User.
 * Hỗ trợ ẩn thông tin (tên, avatar) nếu user bị vô hiệu hóa (maskDisabled = true).
 * Dùng chung cho toàn bộ response trả về client cần populate User.
 */
export const serializeUser = (user: any, maskDisabled = true) => {
    if (
        !user ||
        typeof user !== 'object' ||
        user instanceof Types.ObjectId ||
        !Object.keys(user).includes('_id')
    ) {
        return user ? user.toString() : undefined;
    }

    const isDisabled = user.isDisabled;
    const shouldMask = maskDisabled && isDisabled;

    return {
        ...(user.toJSON ? user.toJSON() : user),
        _id: user._id.toString(),
        name: shouldMask ? 'Tài khoản vô hiệu hóa' : user.name,
        avatar: shouldMask
            ? undefined
            : user.avatar
              ? serializeMedia(user.avatar)
              : user.avatar,
        isDisabled,
        dateOfBirth: shouldMask ? undefined : user.dateOfBirth,
        gender: shouldMask ? undefined : user.gender,
        bio: shouldMask ? undefined : user.bio,
    };
};
