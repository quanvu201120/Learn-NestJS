import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
    @Prop()
    name?: string;

    @Prop({ unique: true, lowercase: true, trim: true, required: true })
    email: string;

    @Prop({ required: true })
    password: string;

    @Prop()
    phone?: string;

    @Prop()
    address?: string;

    @Prop({ type: Types.ObjectId, ref: 'Media' })
    avatar?: Types.ObjectId;

    @Prop({ default: 'USER', enum: ['USER', 'ADMIN'] })
    role: string;

    @Prop({ default: 'LOCAL' })
    accountType: string;

    @Prop({ default: false })
    isActive: boolean;

    @Prop({ default: false })
    isDisabled: boolean;

    @Prop()
    disabledAt?: Date;

    @Prop({ default: 0 })
    tokenVersion: number;

    @Prop()
    lastOnlineAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

export type PayloadJWT = {
    _id: string;
    role: string;
    tokenVersion: number;
    sessionId: string;
};
