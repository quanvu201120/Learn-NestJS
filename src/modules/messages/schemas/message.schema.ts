import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;

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

    @Prop({ type: String, required: true })
    content: string;

    @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
    readBy: Types.ObjectId[];
}

export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ conversationId: 1, createdAt: -1 });
