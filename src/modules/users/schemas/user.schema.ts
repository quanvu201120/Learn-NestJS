import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ _id: false }) // 👈 Tắt _id tự động cho Object con để tránh thừa thãi dữ liệu
export class RefreshTokenClass {
    @Prop({ required: true })
    token: string;
    @Prop({ required: true })
    expiresAt: Date;
}

@Schema({ timestamps: true })
export class User {
    @Prop()
    name: string;

    @Prop({ unique: true, lowercase: true, trim: true })
    email: string;

    @Prop()
    password: string;

    @Prop()
    phone: string;

    @Prop()
    address: string;

    @Prop()
    image: string;

    @Prop({ default: 'USER', enum: ['USER', 'ADMIN'] })
    role: string;

    @Prop({ default: 'LOCAL' })
    accountType: string;

    @Prop({ default: false })
    isActive: boolean;

    @Prop({ type: [RefreshTokenClass], default: [] })
    refreshTokens: RefreshTokenClass[];

    @Prop()
    codeId: string;

    @Prop()
    codeExpired: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

export type PayloadJWT = {
    _id: string;
    role: string;
};
