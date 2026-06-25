import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { RelationshipStatusEnum } from '../types/relationship';

export type RelationshipDocument = HydratedDocument<Relationship>;

@Schema({ timestamps: true })
export class Relationship {
    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    requester: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    recipient: Types.ObjectId;

    @Prop({
        type: String,
        enum: RelationshipStatusEnum,
        default: RelationshipStatusEnum.PENDING,
    })
    status?: RelationshipStatusEnum;

    @Prop({
        type: Types.ObjectId,
        ref: 'User',
    })
    blockedBy?: Types.ObjectId;
}

export const RelationshipSchema = SchemaFactory.createForClass(Relationship);
RelationshipSchema.index({ requester: 1, recipient: 1 }, { unique: true });
