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
    Patch,
    Param,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './passport/local-auth-guard';
import { Cookies, Public, Roles } from '@/utils/decorator-customize';
import * as express from 'express';
import { ConfigService } from '@nestjs/config';
import ms, { StringValue } from 'ms';

import { RegisterAuthDto, LoginDto } from './dto/register-auth.dto';
import {
    ChangePasswordAuthDto,
    ConfirmPasswordAuthDto,
    ForgotPasswordAuthDto,
    ResetPasswordAuthDto,
} from './dto/password-auth.dto';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildDeviceNameFromUA } from '../utils/utils';
import { LoginResponse, RefreshTokenResponse } from './types/auth';
import { UsersService } from '@/modules/users/users.service';
import {
    ActiveAuthDto,
    ResendCodeAuthDto,
    SendCodeUpdateEmailAuthDto,
    UpdateEmailAuthDto,
} from './dto/mail-auth.dto';
import { UserResponse, UserRole } from '@/modules/users/types/user';
import { RolesGuard } from './passport/roles.guard';
import { AdminActionReasonDto } from '@/modules/users/dto/update-user.dto';

@ApiTags('Auth - Xác thực')
@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly configService: ConfigService,
        private readonly userService: UsersService,
    ) {}

    private getRefreshCookieOptions(maxAge?: number) {
        const isProduction =
            this.configService.get<string>('NODE_ENV') === 'production';

        return {
            httpOnly: true,
            secure: isProduction,
            sameSite: isProduction ? ('none' as const) : ('lax' as const),
            ...(maxAge !== undefined ? { maxAge } : {}),
        };
    }

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

        response.cookie(
            'refreshToken',
            data.refreshToken,
            this.getRefreshCookieOptions(
                ms(
                    this.configService.get<string>(
                        'COOKIE_EXPIRES_IN',
                    ) as StringValue,
                ),
            ),
        );

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

        response.cookie(
            'refreshToken',
            data.refreshToken,
            this.getRefreshCookieOptions(
                ms(
                    this.configService.get<string>(
                        'COOKIE_EXPIRES_IN',
                    ) as StringValue,
                ),
            ),
        );
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

        response.clearCookie('refreshToken', this.getRefreshCookieOptions(0));

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
            response.clearCookie(
                'refreshToken',
                this.getRefreshCookieOptions(0),
            );
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

    @Patch('confirm-password')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Xác nhận mật khẩu' })
    async handleConfirmPassword(
        @Body() body: ConfirmPasswordAuthDto,
        @Request() req,
    ) {
        return await this.userService.confirmPassword(
            req.user._id,
            body.password,
        );
    }

    @Post('send-code-update-email')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Gửi mã cập nhật email' })
    async handleSendCodeUpdateEmail(
        @Body() sendCodeUpdateEmailAuthDto: SendCodeUpdateEmailAuthDto,
        @Request() req,
    ) {
        return await this.userService.sendMailUpdateEmail(
            req.user._id,
            sendCodeUpdateEmailAuthDto.email,
        );
    }

    @Patch('update-email')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Cập nhật email' })
    async handleUpdateEmail(
        @Body() updateEmailAuthDto: UpdateEmailAuthDto,
        @Request() req,
    ) {
        await this.userService.updateEmail(
            req.user._id,
            updateEmailAuthDto.email,
            updateEmailAuthDto.code,
        );

        return await this.authService.logoutAllDevices(req.user._id);
    }

    @Post(':id/logoutAll-by-admin')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    @UseGuards(RolesGuard)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Đăng xuất tất cả các thiết bị (Admin)' })
    @ApiBearerAuth('JWT-auth')
    async handleLogoutAllByAdmin(
        @Request() req,
        @Param('id') id: string,
        @Body() body: AdminActionReasonDto,
    ) {
        return await this.authService.logoutAllDevicesByAdmin(
            id,
            req.user._id,
            req.user.role,
            body.reason,
            req,
        );
    }
}
