import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SessionDocument = HydratedDocument<Session>;

@Schema({ timestamps: true })
export class Session {
    @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
    userId: Types.ObjectId;

    @Prop()
    refreshTokenHash?: string;

    @Prop({ type: Date })
    expiresAt?: Date;

    @Prop()
    userAgent?: string;

    @Prop()
    deviceName?: string;

    @Prop({ type: Date, default: Date.now })
    lastUsedAt?: Date;

    @Prop({ default: false })
    isRevoked: boolean;

    @Prop({ type: Date })
    revokedAt?: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
