/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '@/modules/users/users.service';
import { SessionService } from '@/modules/session/session.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(
        private readonly configService: ConfigService,
        private readonly usersService: UsersService,
        private readonly sessionService: SessionService,
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.get<string>('JWT_SECRET')!,
        });
    }

    async validate(payload: any) {
        const user = await this.usersService.findOne(payload._id);
        if (!user) throw new UnauthorizedException('User not found');
        if (user.isDisabled) {
            throw new UnauthorizedException('User has been disabled');
        }

        if (payload.tokenVersion !== user.tokenVersion) {
            throw new UnauthorizedException('Token version invalid');
        }

        const session = await this.sessionService.findSessionById(
            payload.sessionId,
        );
        if (!session) throw new UnauthorizedException('Session not found');

        if (session.userId.toString() !== user._id.toString()) {
            throw new UnauthorizedException('Session ownership invalid');
        }

        if (session.isRevoked) {
            throw new UnauthorizedException('Session revoked');
        }

        return {
            _id: payload._id,
            role: payload.role,
        };
    }
}
