import { PayloadJWT } from '@/modules/users/schemas/user.schema';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { StringValue } from 'ms';

const saltBcypt = 10;

export const hashPassword = async (password: string): Promise<string> => {
    return await bcrypt.hash(password, saltBcypt);
};

export const generateJWT = async (
    payload: { _id: string; role: string },
    configService: ConfigService,
    jwtService: JwtService,
) => {
    const newPayload: PayloadJWT = { _id: payload._id, role: payload.role };
    const accessToken = await jwtService.signAsync(newPayload);
    const refreshToken = await jwtService.signAsync(newPayload, {
        secret: configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: configService.get<StringValue>('JWT_REFRESH_EXPIRES_IN_DB'),
    });
    return { accessToken, refreshToken };
};
