import { UserRole } from '@/modules/users/types/user';
import { Types } from 'mongoose';
import { AuditLog } from '../schemas/audit-log.schema';
import { UserResponse } from '@/modules/users/types/user';

export enum AuditLogActionEnum {
    LOCK_USER = 'LOCK_USER',
    UNLOCK_USER = 'UNLOCK_USER',
    ENABLE_USER = 'ENABLE_USER',
    MUTE_USER = 'MUTE_USER',
    UNMUTE_USER = 'UNMUTE_USER',
    DELETE_AVATAR = 'DELETE_AVATAR',
    RESET_DISPLAY_NAME = 'RESET_DISPLAY_NAME',
    DELETE_BIO = 'DELETE_BIO',
    FORCE_LOGOUT = 'FORCE_LOGOUT',
    CREATE_USER = 'CREATE_USER',
    UPDATE_ROLE = 'UPDATE_ROLE',
    RESOLVE_REPORT = 'RESOLVE_REPORT',
    APPEAL_REPORT = 'APPEAL_REPORT',
    DISMISS_REPORT = 'DISMISS_REPORT',
}

export enum AuditLogTargetEnum {
    USER = 'User',
    REPORT = 'Report',
}

export interface AuditLogEvent {
    req: any; // Request object từ Express
    actorId: string | any;
    actorRole: UserRole;
    action: AuditLogActionEnum;
    targetId: string | any;
    targetType: AuditLogTargetEnum;
    metadata: any;
}

export type AuditLogResponse = Omit<AuditLog, 'actorId' | 'targetId'> & {
    _id?: Types.ObjectId | string;
    actor: UserResponse | Types.ObjectId | string;
    target: UserResponse | Types.ObjectId | string;
    createdAt?: Date;
    updatedAt?: Date;
};

export interface AuditLogResponseWithPagination {
    items: AuditLogResponse[];
    nextCursor: string | null;
}
