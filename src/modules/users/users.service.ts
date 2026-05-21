/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './schemas/user.schema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { hashPassword } from '@/utils/utils';
import aqp from 'api-query-params';

@Injectable()
export class UsersService {
    constructor(@InjectModel(User.name) private userModel: Model<User>) {}

    async create(createUserDto: CreateUserDto) {
        const isEmailExisted = await this.userModel.exists({
            email: createUserDto.email,
        });

        if (isEmailExisted) {
            throw new BadRequestException('Email already existed');
        }

        const password = await hashPassword(createUserDto.password);

        const newUser = await this.userModel.create({
            ...createUserDto,
            password,
        });
        return newUser;
    }

    async findAll(query: string, current: number, pageSize: number) {
        const { filter, sort } = aqp(query);
        if (filter.current) delete filter.current;
        if (filter.pageSize) delete filter.pageSize;

        if (!current) current = 1;
        if (!pageSize) pageSize = 10;

        const totalItems = (await this.userModel.find(filter)).length;
        const totalPages = Math.ceil(totalItems / pageSize);
        const skip = (current - 1) * pageSize;

        const result = await this.userModel
            .find(filter)
            .skip(skip)
            .limit(pageSize)
            .select('-password')
            .sort(sort as any);

        return { result, totalPages };
    }

    findOne(id: number) {
        return `This action returns a #${id} user`;
    }

    update(id: number, updateUserDto: UpdateUserDto) {
        return `This action updates a #${id} user`;
    }

    remove(id: number) {
        return `This action removes a #${id} user`;
    }
}
