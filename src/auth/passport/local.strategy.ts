import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import {
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth.service';
import { AUTH_MESSAGES } from '../constants/auth.constant';
import { USER_MESSAGES } from '@/modules/users/constants/user.constant';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
    constructor(private authService: AuthService) {
        super({
            usernameField: 'identifier',
        });
    }

    async validate(identifier: string, password: string) {
        const user = await this.authService.validateUser(identifier, password);
        if (!user) {
            throw new UnauthorizedException(AUTH_MESSAGES.INVALID_CREDENTIALS);
        }
        if (user.isActive === false) {
            throw new ForbiddenException(USER_MESSAGES.USER_NOT_ACTIVE);
        }
        if (user.isDisabled === true) {
            throw new UnauthorizedException(AUTH_MESSAGES.USER_DISABLED);
        }
        return user;
    }
}
