import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import {
    BadRequestException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth.service';
import { AUTH_MESSAGES } from '../constants/auth.constant';

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
            throw new BadRequestException(AUTH_MESSAGES.USER_NOT_FOUND);
        }
        if (user.isDisabled === true) {
            throw new BadRequestException(AUTH_MESSAGES.USER_DISABLED);
        }
        return user;
    }
}
