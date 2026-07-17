import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { CallEndReasonEnum, CallStatusEnum, CallTypeEnum } from '../types/call';

export type CallDocument = HydratedDocument<Call>;

@Schema({ timestamps: true })
export class Call {
    @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
    callerId: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
    calleeId: Types.ObjectId;

    @Prop({
        type: Types.ObjectId,
        ref: 'Conversation',
        required: true,
        index: true,
    })
    conversationId: Types.ObjectId;

    @Prop({ type: String, enum: CallTypeEnum, required: true })
    callType: CallTypeEnum;

    @Prop({
        type: String,
        enum: CallStatusEnum,
        default: CallStatusEnum.CALLING,
    })
    status: CallStatusEnum;

    @Prop({ type: Date })
    startedAt?: Date;

    @Prop({ type: Date })
    endedAt?: Date;

    @Prop({ type: Number, default: 0 })
    duration: number;

    @Prop({ type: String, enum: CallEndReasonEnum })
    endReason?: CallEndReasonEnum;
}

export const CallSchema = SchemaFactory.createForClass(Call);
CallSchema.index({ status: 1, callerId: 1 });
CallSchema.index({ status: 1, calleeId: 1 });
CallSchema.index({ status: 1, createdAt: -1 });
CallSchema.index({ conversationId: 1, createdAt: -1 });
