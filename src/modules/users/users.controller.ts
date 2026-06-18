/* eslint-disable prettier/prettier */
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
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Roles } from '@/utils/decorator-customize';
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
    @Roles('ADMIN')
    @UseGuards(RolesGuard)
    @ApiOperation({ summary: 'Tạo mới người dùng (Chỉ ADMIN)' })
    create(@Body() createUserDto: CreateUserDto) {
        return this.usersService.create(createUserDto);
    }

    @Get()
    @ApiOperation({ summary: 'Lấy danh sách người dùng phân trang' })
    async findAll(
        @Query() query: string,
        @Query('current') current: string,
        @Query('pageSize') pageSize: string,
    ) {
        const { totalPages, users } = await this.usersService.findAll(
            query,
            +current,
            +pageSize,
        );

        return { totalPages, users };
    }

    @Get(':id')
    @ApiOperation({ summary: 'Lấy thông tin chi tiết một người dùng' })
    async findOne(@Param('id') id: string) {
        return await this.usersService.findOneForApi(id);
    }

    @Patch()
    @ApiOperation({ summary: 'Cập nhật thông tin người dùng' })
    update(@Body() updateUserDto: UpdateUserDto, @Request() req) {
        return this.usersService.update(
            updateUserDto,
            req.user._id,
            req.user.role,
        );
    }

    @Patch('avatar')
    @UseInterceptors(FileInterceptor('file'))
    @ApiOperation({ summary: 'Cập nhật ảnh đại diện của người dùng' })
    uploadAvatar(
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
        return this.usersService.uploadAvatar(req.user._id, file);
    }

    @Delete('avatar')
    @ApiOperation({ summary: 'Xóa ảnh đại diện của người dùng' })
    deleteAvatar(@Request() req) {
        return this.usersService.deleteAvatar(req.user._id);
    }

    @Patch('me/disable')
    @ApiOperation({ summary: 'Người dùng tự vô hiệu hóa tài khoản của mình' })
    async disableSelf(
        @Request() req,
        @Res({ passthrough: true }) response: express.Response,
    ): Promise<UserDisableStateResponse> {
        response.clearCookie(
            'refreshToken',
            this.getRefreshCookieOptions(0),
        );
        return this.usersService.disableSelf(req.user._id);
    }

    @Patch(':id/disable')
    @Roles('ADMIN')
    @UseGuards(RolesGuard)
    @ApiOperation({ summary: 'ADMIN vô hiệu hóa tài khoản user' })
    disableUser(@Param('id') id: string): Promise<UserDisableStateResponse> {
        return this.usersService.disableUserByAdmin(id);
    }

    @Patch(':id/enable')
    @Roles('ADMIN')
    @UseGuards(RolesGuard)
    @ApiOperation({ summary: 'ADMIN gỡ trạng thái vô hiệu hóa user' })
    enableUser(
        @Param('id') id: string,
        @Request() req,
    ): Promise<UserDisableStateResponse> {
        return this.usersService.enableUserByAdmin(id, req.user._id);
    }
}
