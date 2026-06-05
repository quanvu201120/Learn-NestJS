import { UserResponse } from '@/modules/users/types/user';

export type LoginResponse = {
    accessToken: string;
    user: UserResponse;
};

export type RefreshTokenResponse = {
    accessToken: string;
};
