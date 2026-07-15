import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { NotificationTypeEnum } from '../types/notification.type';

export type NotificationDocument = HydratedDocument<Notification>;

@Schema({ _id: false })
export class NotificationSnapshot {
    @Prop({ type: Types.ObjectId, ref: 'Media' })
    avatarMediaId?: Types.ObjectId;

    @Prop()
    displayName?: string;

    @Prop()
    bio?: string;

    @Prop()
    role?: string;
}

@Schema({ timestamps: true })
export class Notification {
    @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
    userId: Types.ObjectId;

    @Prop({
        type: String,
        enum: Object.values(NotificationTypeEnum),
        required: true,
        index: true,
    })
    type: NotificationTypeEnum;

    @Prop({ required: true })
    title: string;

    @Prop({ type: Types.ObjectId, ref: 'Report' })
    refId?: Types.ObjectId;

    @Prop({ type: NotificationSnapshot })
    snapshot?: NotificationSnapshot;

    @Prop()
    reportStatus?: string;

    @Prop()
    reason?: string;

    @Prop()
    penaltyApplied?: string;

    @Prop()
    penaltyType?: string;

    @Prop()
    appealDeadline?: Date;

    @Prop()
    appealReviewDeadline?: Date;

    @Prop({ default: false, index: true })
    isRead: boolean;

    @Prop()
    readAt?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, createdAt: -1 });
