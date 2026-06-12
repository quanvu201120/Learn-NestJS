import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { MessageReactionEnumType } from '../types/message';

export type MessageDocument = HydratedDocument<Message>;
export enum MessageEnumType {
    TEXT = 'text',
    IMAGE = 'image',
    VIDEO = 'video',
    FILE = 'file',
    SYSTEM = 'system',
}
@Schema({ timestamps: true })
export class Message {
    @Prop({
        type: Types.ObjectId,
        ref: 'Conversation',
        required: true,
        index: true,
    })
    conversationId: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    senderId: Types.ObjectId;

    @Prop({
        type: String,
        enum: MessageEnumType,
        default: MessageEnumType.TEXT,
    })
    type: MessageEnumType;

    @Prop({ type: String, required: true })
    content: string;

    @Prop({ type: Types.ObjectId, ref: 'Message' })
    replyTo?: Types.ObjectId;

    //soft delete => hidden
    @Prop({ default: false })
    isDeleted: boolean;

    @Prop({ type: Date })
    deletedAt?: Date;

    @Prop({
        type: [
            {
                _id: false,
                user: { type: Types.ObjectId, ref: 'User' },
                type: { type: String, enum: MessageReactionEnumType },
            },
        ],
        default: [],
    })
    reactions?: {
        user: Types.ObjectId;
        type: MessageReactionEnumType;
    }[];
}

export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ conversationId: 1, createdAt: -1 });
