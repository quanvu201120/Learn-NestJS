import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ConversationDocument = HydratedDocument<Conversation>;

@Schema({ timestamps: true })
export class Conversation {
    @Prop({ type: String })
    name?: string;

    @Prop({ type: Boolean, default: false })
    isGroup: boolean;

    @Prop({
        type: [{ type: Types.ObjectId, ref: 'User' }],
        required: true,
        index: true,
    })
    users: Types.ObjectId[];

    @Prop({ type: Types.ObjectId, ref: 'User' })
    adminGroupId?: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Message' })
    lastMessageId?: Types.ObjectId;

    @Prop({
        type: [
            {
                _id: false,
                userId: { type: Types.ObjectId, ref: 'User' },
                isDeleted: { type: Boolean, default: true },
                deletedAt: { type: Date, default: Date.now },
            },
        ],
        default: undefined,
    })
    deletedHistory?: {
        userId: Types.ObjectId;
        isDeleted?: boolean;
        deletedAt?: Date;
    }[];
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.index({ users: 1, updatedAt: -1 });
