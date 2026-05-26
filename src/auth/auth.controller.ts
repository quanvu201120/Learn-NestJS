/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
    Controller,
    Post,
    Body,
    HttpCode,
    HttpStatus,
    UseGuards,
    Request,
    Get,
    Res,
    Param,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './passport/local-auth-guard';
import { Cookies, Public } from '@/utils/decorator-customize';
import * as express from 'express';
import { ConfigService } from '@nestjs/config';
import ms, { StringValue } from 'ms';

@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly configService: ConfigService,
    ) {}

    @HttpCode(HttpStatus.OK)
    @Public()
    @UseGuards(LocalAuthGuard)
    @Post('login')
    async handleLogin(
        @Request() req,
        @Res({ passthrough: true }) response: express.Response,
    ) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const data = await this.authService.login(req.user);

        response.cookie('refreshToken', data.refreshToken, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            maxAge: ms(
                this.configService.get<string>(
                    'COOKIE_EXPIRES_IN',
                ) as StringValue,
            ),
        });
        const { refreshToken, accessToken, message, user } = data;
        return {
            accessToken,
            result: user,
            message,
        };
    }

    @Post('refreshToken')
    @Public()
    async refreshToken(
        @Cookies('refreshToken') refreshTokenOld: string,
        @Res({ passthrough: true }) response: express.Response,
    ) {
        const data = await this.authService.refreshToken(refreshTokenOld);

        response.cookie('refreshToken', data.refreshToken, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            maxAge: ms(
                this.configService.get<string>(
                    'COOKIE_EXPIRES_IN',
                ) as StringValue,
            ),
        });

        return data.accessToken;
    }

    @Post('logout')
    @Public()
    @HttpCode(HttpStatus.OK)
    async handleLogout(
        @Res({ passthrough: true }) response: express.Response,
        @Cookies('refreshToken') refreshToken: string,
        @Request() req,
    ) {
        try {
            await this.authService.logout(refreshToken, req.user._id);
        } catch (error) {
            /* empty */
        }

        response.clearCookie('refreshToken', {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            maxAge: 0,
        });

        return null;
    }
}
