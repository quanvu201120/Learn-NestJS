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

@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    @Post()
    @Roles('ADMIN')
    @UseGuards(RolesGuard)
    create(@Body() createUserDto: CreateUserDto) {
        return this.usersService.create(createUserDto);
    }

    @Get()
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
    findOne(@Param('id') id: string) {
        return this.usersService.findOne(id);
    }

    @Patch()
    update(@Body() updateUserDto: UpdateUserDto) {
        return this.usersService.update(updateUserDto);
    }

    @Delete(':id')
    remove(@Param() deleteDto: DeleteUserDto) {
        return this.usersService.remove(deleteDto.id);
    }
}
