/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '@/modules/users/users.service';
import { SessionService } from '@/modules/session/session.service';
import { AUTH_MESSAGES } from '../constants/auth.constant';
import { formatDateTime } from '@/utils/utils';

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
        if (!user)
            throw new UnauthorizedException(AUTH_MESSAGES.USER_NOT_FOUND);
        if (user.isDisabled) {
            throw new UnauthorizedException(AUTH_MESSAGES.USER_DISABLED);
        }
        if (user.banUntil && user.banUntil > new Date()) {
            const time = formatDateTime(user.banUntil);
            throw new UnauthorizedException(
                AUTH_MESSAGES.ACCOUNT_BANNED_UNTIL(time),
            );
        }
        if (!user.isActive) {
            throw new UnauthorizedException(AUTH_MESSAGES.USER_NOT_FOUND);
        }

        if (payload.tokenVersion !== user.tokenVersion) {
            throw new UnauthorizedException(
                AUTH_MESSAGES.TOKEN_VERSION_MISMATCH,
            );
        }

        const session = await this.sessionService.findSessionById(
            payload.sessionId,
        );
        if (!session)
            throw new UnauthorizedException(AUTH_MESSAGES.SESSION_NOT_FOUND);

        if (session.userId.toString() !== user._id.toString()) {
            throw new UnauthorizedException(
                AUTH_MESSAGES.SESSION_USER_NOT_MATCH,
            );
        }

        if (session.isRevoked) {
            throw new UnauthorizedException(AUTH_MESSAGES.SESSION_REVOKED);
        }

        return {
            _id: payload._id,
            role: payload.role,
        };
    }
}
