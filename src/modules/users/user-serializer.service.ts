import { Injectable } from '@nestjs/common';
import { UserResponse } from './types/user';
import { serializeAdminUser, serializeUser } from './utils/user.serializer';

@Injectable()
export class UserSerializerService {
    /**
     * Chuáº©n hÃ³a dá»¯ liá»‡u avatar lá»“ng bÃªn trong trÆ°á»›c khi tráº£ object user vá» cho client.
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
