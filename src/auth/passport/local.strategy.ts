import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import {
    BadRequestException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth.service';

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
            throw new UnauthorizedException(
                'Tài khoản hoặc mật khẩu không hợp lệ',
            );
        }
        if (user.isActive === false) {
            throw new BadRequestException('User is not active');
        }
        if (user.isDisabled === true) {
            throw new BadRequestException('User has been disabled');
        }
        return user;
    }
}
