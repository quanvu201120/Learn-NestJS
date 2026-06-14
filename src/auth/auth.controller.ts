/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { AUTH_MESSAGES } from './constants/auth.constant';
import {
    Controller,
    Post,
    Body,
    HttpCode,
    HttpStatus,
    UseGuards,
    Request,
    Res,
    InternalServerErrorException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './passport/local-auth-guard';
import { Cookies, Public } from '@/utils/decorator-customize';
import * as express from 'express';
import { ConfigService } from '@nestjs/config';
import ms, { StringValue } from 'ms';

import {
    ActiveAuthDto,
    RegisterAuthDto,
    ResendCodeAuthDto,
    LoginDto,
} from './dto/register-auth.dto';
import {
    ChangePasswordAuthDto,
    ForgotPasswordAuthDto,
    ResetPasswordAuthDto,
} from './dto/password-auth.dto';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildDeviceNameFromUA } from '@/utils/utils';
import { LoginResponse, RefreshTokenResponse } from './types/auth';

@ApiTags('Auth - Xác thực')
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
    @ApiOperation({ summary: 'Đăng nhập tài khoản' })
    @ApiBody({ type: LoginDto })
    async handleLogin(
        @Request() req,
        @Res({ passthrough: true }) response: express.Response,
    ) {
        const userAgent = req.headers['user-agent'] as string | undefined;
        const deviceName = buildDeviceNameFromUA(userAgent);
        const data = await this.authService.login(
            req.user,
            userAgent,
            deviceName,
        );

        response.cookie('refreshToken', data.refreshToken, {
            httpOnly: true,
            secure:
                this.configService.get<string>('NODE_ENV') === 'production'
                    ? true
                    : false,
            sameSite: 'lax',
            maxAge: ms(
                this.configService.get<string>(
                    'COOKIE_EXPIRES_IN',
                ) as StringValue,
            ),
        });

        return {
            accessToken: data.accessToken,
            user: data.user,
        } as LoginResponse;
    }

    @Post('refreshToken')
    @Public()
    @ApiOperation({ summary: 'Làm mới token (Refresh Token)' })
    async refreshToken(
        @Cookies('refreshToken') refreshTokenOld: string,
        @Res({ passthrough: true }) response: express.Response,
    ) {
        const data = await this.authService.refreshToken(refreshTokenOld);

        response.cookie('refreshToken', data.refreshToken, {
            httpOnly: true,
            secure:
                this.configService.get<string>('NODE_ENV') === 'production'
                    ? true
                    : false,
            sameSite: 'lax',
            maxAge: ms(
                this.configService.get<string>(
                    'COOKIE_EXPIRES_IN',
                ) as StringValue,
            ),
        });
        const res: RefreshTokenResponse = {
            accessToken: data.accessToken,
        };
        return res;
    }

    @Post('logout')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Đăng xuất tài khoản' })
    @ApiBearerAuth('JWT-auth')
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
            secure:
                this.configService.get<string>('NODE_ENV') === 'production'
                    ? true
                    : false,
            sameSite: 'lax',
            maxAge: 0,
        });

        return AUTH_MESSAGES.LOGOUT_SUCCESS;
    }

    @Post('logoutAll')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Đăng xuất tất cả các thiết bị' })
    @ApiBearerAuth('JWT-auth')
    async handleLogoutAll(
        @Res({ passthrough: true }) response: express.Response,
        @Request() req,
    ) {
        try {
            await this.authService.logoutAllDevices(req.user._id);
            response.clearCookie('refreshToken', {
                httpOnly: true,
                secure:
                    this.configService.get<string>('NODE_ENV') === 'production'
                        ? true
                        : false,
                sameSite: 'lax',
                maxAge: 0,
            });
            return AUTH_MESSAGES.LOGOUT_ALL_SUCCESS;
        } catch (error) {
            throw new InternalServerErrorException(
                AUTH_MESSAGES.LOGOUT_ALL_FAILED,
            );
        }
    }

    @Post('register')
    @Public()
    @ApiOperation({ summary: 'Đăng ký tài khoản mới' })
    async handleRegister(@Body() registerAuthDto: RegisterAuthDto) {
        const data = await this.authService.register(registerAuthDto);
        return data;
    }

    @Post('active')
    @HttpCode(HttpStatus.OK)
    @Public()
    @ApiOperation({ summary: 'Kích hoạt tài khoản bằng mã code gửi qua email' })
    async handleActive(@Body() activeAuthDto: ActiveAuthDto) {
        return await this.authService.activateUser(
            activeAuthDto.email,
            activeAuthDto.code,
        );
    }

    @Post('resend-code-active')
    @HttpCode(HttpStatus.OK)
    @Public()
    @ApiOperation({ summary: 'Gửi lại mã kích hoạt tài khoản' })
    async handleResendCodeActive(@Body() resendCodeAuthDto: ResendCodeAuthDto) {
        return await this.authService.reSendCodeActive(resendCodeAuthDto.email);
    }

    @Post('change-password')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Thay đổi mật khẩu' })
    @ApiBearerAuth('JWT-auth')
    async handleChangePassword(
        @Body() changePasswordAuthDto: ChangePasswordAuthDto,
        @Request() req,
    ) {
        return await this.authService.changePassword(
            req.user._id,
            changePasswordAuthDto,
        );
    }

    @Post('forgot-password')
    @Public()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Yêu cầu gửi mã đặt lại mật khẩu (Quên mật khẩu)',
    })
    async handleForgotPassword(
        @Body() forgotPasswordAuthDto: ForgotPasswordAuthDto,
    ) {
        return await this.authService.forgotPassword(
            forgotPasswordAuthDto.email,
        );
    }

    @Post('reset-password')
    @Public()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Đặt lại mật khẩu mới' })
    async handleResetPassword(
        @Body() resetPasswordAuthDto: ResetPasswordAuthDto,
    ) {
        return await this.authService.resetPassword(resetPasswordAuthDto);
    }
}
