import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '@/utils/decorator-customize';

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.getAllAndOverride<string[]>(
            ROLES_KEY,
            [context.getHandler(), context.getClass()],
        );
        if (!requiredRoles) {
            return true;
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const { user } = context.switchToHttp().getRequest();

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (!user || !user.role) {
            throw new ForbiddenException(
                'Bạn không có quyền truy cập endpoint này',
            );
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const hasRole = requiredRoles.some((role) => role === user.role);
        if (!hasRole) {
            throw new ForbiddenException(
                'Bạn không có quyền truy cập: Yêu cầu quyền ' +
                    requiredRoles.join(' hoặc '),
            );
        }
        return true;
    }
}
