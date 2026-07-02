/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    Query,
    UseGuards,
    Request,
    Res,
    UseInterceptors,
    UploadedFile,
    ParseFilePipe,
    FileTypeValidator,
    MaxFileSizeValidator,
    BadRequestException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import {
    UpdateRoleBySuperAdminDto,
    UpdateUserDto,
} from './dto/update-user.dto';
import { Roles } from '@/utils/decorator-customize';
import { UserRole } from './types/user';
import { RolesGuard } from '@/auth/passport/roles.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import * as express from 'express';
import { ConfigService } from '@nestjs/config';
import { UserDisableStateResponse } from './types/user';

@ApiTags('Users - Quản lý người dùng')
@ApiBearerAuth('JWT-auth')
@Controller('users')
export class UsersController {
    constructor(
        private readonly usersService: UsersService,
        private readonly configService: ConfigService,
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

    @Post()
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    @UseGuards(RolesGuard)
    @ApiOperation({ summary: 'Tạo mới người dùng (Chỉ ADMIN)' })
    async create(@Body() createUserDto: CreateUserDto, @Request() req) {
        return await this.usersService.create(createUserDto, req.user?.role);
    }

    @Get()
    @ApiOperation({ summary: 'Lấy danh sách người dùng phân trang' })
    async findAll(
        @Query() query: string,
        @Query('current') current: string,
        @Query('pageSize') pageSize: string,
    ) {
        const { totalPages, totalItems, users } =
            await this.usersService.findAll(query, +current, +pageSize);

        return { totalPages, totalItems, users };
    }

    @Get('search')
    @ApiOperation({ summary: 'Tìm kiếm người dùng bằng email hoặc sdt' })
    async searchUser(@Query('query') query: string, @Request() req) {
        if (!query) {
            throw new BadRequestException(
                'Vui lòng nhập email hoặc số điện thoại',
            );
        }
        return await this.usersService.findOneByEmailOrPhone(
            req.user._id,
            query,
        );
    }

    @Get(':id')
    @ApiOperation({ summary: 'Lấy thông tin chi tiết một người dùng' })
    async findOne(@Param('id') id: string) {
        return await this.usersService.findOneForApi(id);
    }

    @Patch('me')
    @ApiOperation({ summary: 'Cập nhật thông tin cá nhân của bản thân' })
    async updateSelf(@Body() updateUserDto: UpdateUserDto, @Request() req) {
        return await this.usersService.update(updateUserDto, req.user._id);
    }

    @Patch('avatar')
    @UseInterceptors(FileInterceptor('file'))
    @ApiOperation({ summary: 'Cập nhật ảnh đại diện của người dùng' })
    async uploadAvatar(
        @UploadedFile(
            new ParseFilePipe({
                validators: [
                    new FileTypeValidator({ fileType: 'image/*' }),
                    new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
                ],
            }),
        )
        file: Express.Multer.File,
        @Request() req,
    ) {
        return await this.usersService.uploadAvatar(req.user._id, file);
    }

    @Delete('avatar')
    @ApiOperation({ summary: 'Xóa ảnh đại diện của người dùng' })
    async deleteAvatar(@Request() req) {
        return await this.usersService.deleteAvatar(req.user._id);
    }

    @Patch('me/disable')
    @ApiOperation({ summary: 'Người dùng tự vô hiệu hóa tài khoản của mình' })
    async disableSelf(
        @Request() req,
        @Res({ passthrough: true }) response: express.Response,
    ): Promise<UserDisableStateResponse> {
        response.clearCookie('refreshToken', this.getRefreshCookieOptions(0));
        return await this.usersService.disableSelf(req.user._id);
    }

    @Patch(':id/reset-name')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    @UseGuards(RolesGuard)
    @ApiOperation({ summary: 'Admin đặt lại tên user' })
    async resetNameByAdmin(@Param('id') id: string, @Request() req) {
        return await this.usersService.resetNameByAdmin(
            id,
            req.user._id,
            req.user.role,
        );
    }

    @Patch(':id/clear-bio')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    @UseGuards(RolesGuard)
    @ApiOperation({ summary: 'Admin xóa tiểu sử user' })
    async clearBioByAdmin(@Param('id') id: string, @Request() req) {
        return await this.usersService.clearBioByAdmin(
            id,
            req.user._id,
            req.user.role,
        );
    }

    @Patch(':id/disable')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    @UseGuards(RolesGuard)
    @ApiOperation({ summary: 'ADMIN vô hiệu hóa tài khoản user' })
    async disableUser(
        @Param('id') id: string,
        @Request() req,
    ): Promise<UserDisableStateResponse> {
        return await this.usersService.disableUserByAdmin(
            id,
            req.user._id,
            req.user.role,
        );
    }

    @Patch(':id/enable')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    @UseGuards(RolesGuard)
    @ApiOperation({ summary: 'ADMIN gỡ trạng thái vô hiệu hóa user' })
    async enableUser(
        @Param('id') id: string,
        @Request() req,
    ): Promise<UserDisableStateResponse> {
        return await this.usersService.enableUserByAdmin(
            id,
            req.user._id,
            req.user.role,
        );
    }

    @Delete(':id/avatar')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    @UseGuards(RolesGuard)
    @ApiOperation({
        summary: 'Admin xóa ảnh đại diện của user',
    })
    async deleteAvatarByAdmin(@Param('id') id: string, @Request() req) {
        return await this.usersService.deleteAvatarByAdmin(
            id,
            req.user._id,
            req.user.role,
        );
    }

    @Patch(':id/role')
    @Roles(UserRole.SUPER_ADMIN)
    @UseGuards(RolesGuard)
    @ApiOperation({
        summary: 'SUPER_ADMIN thay đổi Role của user (yêu cầu mật khẩu)',
    })
    async changeRoleBySuperAdmin(
        @Param('id') id: string,
        @Body() updateRoleDto: UpdateRoleBySuperAdminDto,
        @Request() req,
    ) {
        return await this.usersService.changeRoleBySuperAdmin(
            id,
            updateRoleDto.role,
            req.user._id,
            updateRoleDto.password,
        );
    }
}
