import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
    CleanupJobActionEnum,
    CleanupJobEntityEnum,
    CleanupJobLockedBy,
    CleanupJobResourceEnum,
    CleanupJobStatusEnum,
} from '../types/cleanup-job';
import { CLEANUP_JOB_CONSTANTS } from '../constants/cleanup-job.constant';

export type CleanupJobDocument = HydratedDocument<CleanupJob>;

@Schema({ _id: false })
export class CleanupJobPayload {
    @Prop({ type: String })
    publicId?: string;

    @Prop({ type: [String] })
    publicIds?: string[];

    @Prop({ type: String })
    objectKey?: string;

    @Prop({ type: [String] })
    objectKeys?: string[];

    @Prop({ type: String })
    userId?: string;

    @Prop({ type: [String] })
    userIds?: string[];

    @Prop({ type: String })
    conversationId?: string;

    @Prop({ type: String })
    sessionId?: string;
}

@Schema({ timestamps: true })
export class CleanupJob {
    @Prop({
        type: String,
        enum: CleanupJobStatusEnum,
        required: true,
        default: CleanupJobStatusEnum.PENDING,
    })
    status: CleanupJobStatusEnum;

    @Prop({
        type: String,
        enum: CleanupJobResourceEnum,
        required: true,
    })
    resourceType: CleanupJobResourceEnum;

    @Prop({
        type: String,
        enum: CleanupJobActionEnum,
        required: true,
    })
    action: CleanupJobActionEnum;

    @Prop({
        type: Types.ObjectId,
    })
    entityId?: Types.ObjectId;

    @Prop({ type: String, enum: CleanupJobEntityEnum, required: true })
    entityType: CleanupJobEntityEnum;

    @Prop({
        type: CleanupJobPayload,
        required: true,
    })
    payload: CleanupJobPayload;

    @Prop({
        type: Date,
    })
    nextRetryAt?: Date;

    @Prop({
        type: Number,
        default: 0,
    })
    retryCount: number;

    @Prop({
        type: Number,
        default: CLEANUP_JOB_CONSTANTS.DEFAULT_MAX_RETRIES,
    })
    maxRetries: number;

    @Prop({
        type: Date,
    })
    lastTriedAt?: Date;

    @Prop({
        type: Date,
    })
    resolvedAt?: Date;

    @Prop({
        type: String,
    })
    error?: string;

    @Prop({
        type: Date,
    })
    lockedAt?: Date;

    @Prop({
        type: String,
        enum: CleanupJobLockedBy,
    })
    lockedBy?: CleanupJobLockedBy;

    @Prop({
        type: Date,
    })
    lockedUntil?: Date;
}

export const CleanupJobSchema = SchemaFactory.createForClass(CleanupJob);

const actionPayloadRules: Record<
    CleanupJobActionEnum,
    (keyof CleanupJobPayload)[]
> = {
    [CleanupJobActionEnum.CLOUDINARY_DELETE_ONE]: ['publicId'],
    [CleanupJobActionEnum.CLOUDINARY_DELETE_MANY]: ['publicIds'],
    [CleanupJobActionEnum.R2_DELETE_ONE]: ['objectKey'],
    [CleanupJobActionEnum.R2_DELETE_MANY]: ['objectKeys'],
    [CleanupJobActionEnum.REDIS_REMOVE_UNSEEN_ONE]: [
        'userId',
        'conversationId',
    ],
    [CleanupJobActionEnum.REDIS_REMOVE_UNSEEN_MANY]: [
        'userIds',
        'conversationId',
    ],
    [CleanupJobActionEnum.SESSION_REVOKE]: ['userId', 'sessionId'],
    [CleanupJobActionEnum.SESSION_REVOKE_ALL]: ['userId'],
};

function isMissingPayloadValue(value: unknown) {
    if (Array.isArray(value) && value.length === 0) {
        return true;
    }

    if (value === undefined || value === null || value === '') {
        return true;
    }

    return false;
}

CleanupJobSchema.pre('validate', function () {
    const payload = this.payload as CleanupJobPayload | undefined;
    const action = this.action as CleanupJobActionEnum | undefined;

    if (!payload || !action) {
        return;
    }

    const requiredKeys = actionPayloadRules[action] ?? [];
    const missingKeys = requiredKeys.filter((key) =>
        isMissingPayloadValue(payload[key]),
    );

    if (missingKeys.length > 0) {
        this.invalidate(
            'payload',
            `Payload is invalid for action "${action}". Missing fields: ${missingKeys.join(', ')}`,
        );
    }
});

CleanupJobSchema.index({
    status: 1,
    nextRetryAt: 1,
});
