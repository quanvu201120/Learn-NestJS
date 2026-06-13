import { Media, MediaSchema } from '@/modules/media/schemas/media.schema';
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
                isHidden: { type: Boolean, default: true },
                hiddenAt: { type: Date, default: Date.now },
            },
        ],
        default: [],
    })
    hiddenHistory: {
        userId: Types.ObjectId;
        isHidden?: boolean;
        hiddenAt?: Date;
    }[];

    @Prop({
        type: Map,
        of: { type: Types.ObjectId, ref: 'Message' },
        default: {},
    })
    readReceipts?: Map<string, Types.ObjectId>;

    @Prop({ type: MediaSchema })
    avatar?: Media;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.index({ users: 1, updatedAt: -1 });
