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
    UseInterceptors,
    UploadedFile,
    ParseFilePipe,
    FileTypeValidator,
    MaxFileSizeValidator,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { DeleteUserDto } from './dto/delete-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Roles } from '@/utils/decorator-customize';
import { RolesGuard } from '@/auth/passport/roles.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';

@ApiTags('Users - Quản lý người dùng')
@ApiBearerAuth('JWT-auth')
@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

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

    @Delete(':id')
    @ApiOperation({ summary: 'Xóa người dùng theo ID' })
    remove(@Param() deleteDto: DeleteUserDto) {
        return this.usersService.deleteUser(deleteDto.id);
    }
}
