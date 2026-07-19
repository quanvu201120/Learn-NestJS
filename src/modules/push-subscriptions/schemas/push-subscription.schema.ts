import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PushSubscriptionDocument = HydratedDocument<PushSubscription>;

@Schema({ timestamps: true })
export class PushSubscription {
    @Prop({ required: true, index: true })
    deviceId: string;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
    userId: Types.ObjectId;

    @Prop({ required: true, unique: true })
    endpoint: string;

    @Prop({ required: true })
    p256dh: string;

    @Prop({ required: true })
    auth: string;

    @Prop({ default: true, index: true })
    isActive: boolean;

    @Prop({ type: Date })
    lastUsedAt?: Date;
}

export const PushSubscriptionSchema =
    SchemaFactory.createForClass(PushSubscription);

PushSubscriptionSchema.index({ userId: 1, isActive: 1 });
PushSubscriptionSchema.index({ deviceId: 1, isActive: 1 });
PushSubscriptionSchema.index({ isActive: 1, lastUsedAt: 1 });
