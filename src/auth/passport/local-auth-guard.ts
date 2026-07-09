/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
    ExecutionContext,
    Injectable,
    BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { VALIDATION_MESSAGES } from '@/common/constants/validation.constant';
@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const { identifier, password } = request.body || {};
        // 1. Kiểm tra rỗng
        if (!identifier) {
            throw new BadRequestException(
                VALIDATION_MESSAGES.EMAIL_OR_PHONE_REQUIRED,
            );
        }
        if (!password) {
            throw new BadRequestException(
                VALIDATION_MESSAGES.PASSWORD_REQUIRED,
            );
        }
        // 2. Kiểm tra định dạng Email hoặc Số điện thoại
        const identifierRegex =
            /^(?:[^\s@]+@[^\s@]+\.[^\s@]+|(?:0|\+84)[3|5|7|8|9][0-9]{8})$/;
        if (!identifierRegex.test(identifier)) {
            throw new BadRequestException(
                VALIDATION_MESSAGES.EMAIL_OR_PHONE_INVALID,
            );
        }
        // 3. Cho phép Passport local strategy tiếp tục xử lý
        const result = (await super.canActivate(context)) as boolean;
        return result;
    }
}
