import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { UserAccountType, UserGenderEnum, UserRole } from '../types/user';

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

    @Prop()
    dateOfBirth?: Date;

    @Prop({ type: String, enum: UserGenderEnum, default: UserGenderEnum.OTHER })
    gender?: UserGenderEnum;

    @Prop()
    bio?: string;

    @Prop({ type: Types.ObjectId, ref: 'Media' })
    avatar?: Types.ObjectId;

    @Prop({
        type: String,
        default: UserRole.USER,
        enum: Object.values(UserRole),
    })
    role: UserRole;

    @Prop({
        type: String,
        enum: UserAccountType,
        default: UserAccountType.LOCAL,
    })
    accountType: UserAccountType;

    @Prop({ default: true })
    hasPassword: boolean;

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

    @Prop()
    banUntil?: Date;

    @Prop()
    muteUntil?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

export type PayloadJWT = {
    _id: string;
    role: string;
    tokenVersion: number;
    sessionId: string;
};
