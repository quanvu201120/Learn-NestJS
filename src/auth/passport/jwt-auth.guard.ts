import {
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '@/utils/decorator-customize';
import { Reflector } from '@nestjs/core';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    constructor(private reflector: Reflector) {
        super();
    }
    canActivate(context: ExecutionContext) {
        const isPublic = this.reflector.getAllAndOverride<boolean>(
            IS_PUBLIC_KEY,
            [context.getHandler(), context.getClass()],
        );
        if (isPublic) {
            return true;
        }
        return super.canActivate(context);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    handleRequest(err, user, info) {
        if (err || !user) {
            throw err || new UnauthorizedException('AccessToken không hợp lệ');
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return user;
    }
}
