import { AUTH_MESSAGES } from '@/auth/constants/auth.constant';
import { formatDateTime } from '@/utils/utils';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { SessionService } from '../session/session.service';
import { USER_MESSAGES } from '../users/constants/user.constant';
import { PayloadJWT } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { REALTIME_MESSAGES } from './constants/realtime.constant';

@Injectable()
export class RealtimeAuthService {
    constructor(
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly usersService: UsersService,
        private readonly sessionService: SessionService,
    ) {}

    /**
     * Helper: Xác thực và lấy payload JWT từ Socket.
     */
    async validateUse(client: Socket) {
        const payload = client.data.user as PayloadJWT | undefined;
        if (payload?._id) {
            return payload;
        }

        const token = client.handshake.auth?.token as string | undefined;
        if (!token) {
            throw new UnauthorizedException(REALTIME_MESSAGES.MISSING_TOKEN);
        }

        const verifiedPayload: PayloadJWT = await this.jwtService.verifyAsync(
            token,
            {
                secret: this.configService.get<string>('JWT_SECRET'),
            },
        );
        client.data.user = verifiedPayload;

        return verifiedPayload;
    }

    /**
     * Re-check user/session state for write actions so old sockets cannot keep
     * mutating data after logout, logout-all, or session revocation.
     */
    async validateActiveSession(client: Socket) {
        const payload = await this.validateUse(client);

        const user = await this.usersService.findOne(payload._id);
        if (!user) {
            client.disconnect();
            throw new UnauthorizedException(USER_MESSAGES.USER_NOT_FOUND);
        }

        if (!user.isActive) {
            client.disconnect();
            throw new UnauthorizedException(USER_MESSAGES.USER_NOT_ACTIVE);
        }

        if (user.isDisabled) {
            client.disconnect();
            throw new UnauthorizedException(AUTH_MESSAGES.USER_DISABLED);
        }

        if (user.banUntil && user.banUntil > new Date()) {
            client.disconnect();
            const time = formatDateTime(user.banUntil);
            throw new UnauthorizedException(
                AUTH_MESSAGES.ACCOUNT_BANNED_UNTIL(time),
            );
        }

        if (payload.tokenVersion !== user.tokenVersion) {
            client.disconnect();
            throw new UnauthorizedException(
                AUTH_MESSAGES.TOKEN_VERSION_MISMATCH,
            );
        }

        const session = await this.sessionService.findSessionById(
            payload.sessionId,
        );
        if (!session) {
            client.disconnect();
            throw new UnauthorizedException(AUTH_MESSAGES.SESSION_NOT_FOUND);
        }

        if (session.userId.toString() !== payload._id) {
            client.disconnect();
            throw new UnauthorizedException(
                AUTH_MESSAGES.SESSION_USER_NOT_MATCH,
            );
        }

        if (session.isRevoked) {
            client.disconnect();
            throw new UnauthorizedException(AUTH_MESSAGES.SESSION_REVOKED);
        }

        return payload;
    }
}
