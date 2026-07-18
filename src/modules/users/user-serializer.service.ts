import { Injectable } from '@nestjs/common';
import { UserResponse } from './types/user';
import { serializeAdminUser, serializeUser } from './utils/user.serializer';

@Injectable()
export class UserSerializerService {
    /**
     * Chuẩn hóa dữ liệu avatar lồng bên trong trước khi trả object user về cho client.
     */
    serializeUserResponse(
        user: UserResponse | null,
        forAdmin = false,
        hidden = false,
    ) {
        if (!user) {
            return user;
        }

        return forAdmin
            ? (serializeAdminUser(user) as UserResponse)
            : (serializeUser(user, false, hidden) as UserResponse);
    }
}
