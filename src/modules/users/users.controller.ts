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
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { DeleteUserDto } from './dto/delete-user.dto';
import { UpdateUserDto } from './dto/update-user.dto copy';
import { Roles } from '@/utils/decorator-customize';
import { RolesGuard } from '@/auth/passport/roles.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

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
        const { totalPages, userList } = await this.usersService.findAll(
            query,
            +current,
            +pageSize,
        );
        const result = { totalPages, userList };
        return result;
    }

    @Get(':id')
    @ApiOperation({ summary: 'Lấy thông tin chi tiết một người dùng' })
    findOne(@Param('id') id: string) {
        return this.usersService.findOne(id);
    }

    @Patch()
    @ApiOperation({ summary: 'Cập nhật thông tin người dùng' })
    update(@Body() updateUserDto: UpdateUserDto) {
        return this.usersService.update(updateUserDto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Xóa người dùng theo ID' })
    remove(@Param() deleteDto: DeleteUserDto) {
        return this.usersService.deleteUser(deleteDto.id);
    }
}
