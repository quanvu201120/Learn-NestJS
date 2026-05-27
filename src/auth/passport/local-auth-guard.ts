/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
    ExecutionContext,
    Injectable,
    BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const { email, password } = request.body || {};
        // 1. Kiểm tra rỗng
        if (!email) {
            throw new BadRequestException('Email không được để trống');
        }
        if (!password) {
            throw new BadRequestException('Mật khẩu không được để trống');
        }
        // 2. Kiểm tra định dạng Email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            throw new BadRequestException('Email không đúng định dạng');
        }
        // 3. Cho phép Passport local strategy tiếp tục xử lý
        const result = (await super.canActivate(context)) as boolean;
        return result;
    }
}
