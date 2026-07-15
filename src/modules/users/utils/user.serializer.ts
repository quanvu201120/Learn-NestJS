/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Types } from 'mongoose';
import { serializeMedia } from '@/modules/media/utils/media.serializer';
import { BAN_PERMANENT_DAYS } from '@/modules/reports/constants/penalty.constant';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const getUserStatusLabel = (user: any): string | null => {
    if (!user || typeof user !== 'object' || user instanceof Types.ObjectId) {
        return null;
    }

    if (user.isDisabled) {
        return 'vô hiệu hóa';
    }

    if (user.banUntil) {
        const banUntil =
            user.banUntil instanceof Date
                ? user.banUntil
                : new Date(user.banUntil);
        if (!Number.isNaN(banUntil.getTime()) && banUntil > new Date()) {
            const remainingDays = Math.ceil(
                (banUntil.getTime() - Date.now()) / DAY_IN_MS,
            );

            if (remainingDays >= BAN_PERMANENT_DAYS) {
                return 'khóa vĩnh viễn';
            }

            return `khóa ${remainingDays} ngày`;
        }
    }

    return null;
};

/**
 * Chuẩn hóa thông tin User cho response public.
 */
export const serializeUser = (
    user: any,
    maskDisabled = true,
    hidden = false,
) => {
    return serializeUserInternal(user, maskDisabled, true, hidden);
};

/**
 * Chuẩn hóa thông tin User cho response admin.
 * Admin response giữ đầy đủ dữ liệu như document đã populate.
 */
export const serializeAdminUser = (user: any) => {
    return serializeUserInternal(user, false, false);
};

const serializeUserInternal = (
    user: any,
    maskDisabled = true,
    omitContact = true,
    hidden = false,
) => {
    if (
        !user ||
        typeof user !== 'object' ||
        user instanceof Types.ObjectId ||
        !Object.keys(user).includes('_id')
    ) {
        return user ? user.toString() : undefined;
    }

    const shouldMask = maskDisabled && !!user.isDisabled;

    const serialized = {
        ...(user.toJSON ? user.toJSON() : user),
        _id: user._id.toString(),
        name: shouldMask
            ? 'Tài khoản vô hiệu hóa'
            : hidden
              ? 'Người dùng bị ẩn'
              : user.name,
        avatar:
            shouldMask || hidden
                ? undefined
                : user.avatar
                  ? serializeMedia(user.avatar)
                  : user.avatar,
        isDisabled: user.isDisabled,
        banUntil: hidden
            ? undefined
            : user.banUntil
              ? new Date(user.banUntil).toISOString()
              : undefined,
        disabledAt: user.disabledAt
            ? new Date(user.disabledAt).toISOString()
            : undefined,
        dateOfBirth: shouldMask || hidden ? undefined : user.dateOfBirth,
        gender: shouldMask || hidden ? undefined : user.gender,
        bio: shouldMask || hidden ? undefined : user.bio,
        address: shouldMask || hidden ? undefined : user.address,
    };

    if (omitContact) {
        delete serialized.email;
        delete serialized.phone;
    }
    delete serialized.password;

    return serialized;
};
