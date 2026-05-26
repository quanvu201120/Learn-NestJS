/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { User } from './schemas/user.schema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { hashPassword } from '@/utils/utils';
import aqp from 'api-query-params';
import { UpdateUserDto } from './dto/update-user.dto copy';
import { ConfigService } from '@nestjs/config';
import ms, { StringValue } from 'ms';
import { v4 as uuidv4 } from 'uuid';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class UsersService {
    constructor(
        @InjectModel(User.name) private userModel: Model<User>,
        private configService: ConfigService,
        private readonly mailerService: MailerService,
    ) {}
    async create(createUserDto: CreateUserDto) {
        const isEmailExisted = await this.userModel.exists({
            email: createUserDto.email,
        });

        if (isEmailExisted) {
            throw new BadRequestException('Email already existed');
        }

        const password = await hashPassword(createUserDto.password);
        const codeId = uuidv4();

        const expireTime =
            this.configService.get<string>('MAIL_CODE_EXPIRE') || '30m';
        const newUser = await this.userModel.create({
            ...createUserDto,
            password,
            isActive: false,
            codeId,
            codeExpired: new Date(Date.now() + ms(expireTime as StringValue)),
        });

        this.sendEmail(newUser.email, codeId).catch((error) => {
            console.error(error);
        });

        return newUser;
    }

    async register(email: string, password: string) {
        const isEmailExisted = await this.userModel.exists({
            email,
        });

        if (isEmailExisted) {
            throw new BadRequestException('Email already existed');
        }

        const passHash = await hashPassword(password);
        const codeId = uuidv4();

        const expireTime =
            this.configService.get<string>('MAIL_CODE_EXPIRE') || '30m';
        const newUser = await this.userModel.create({
            email,
            password: passHash,
            role: 'USER',
            isActive: false,
            codeId,
            codeExpired: new Date(Date.now() + ms(expireTime as StringValue)),
        });

        this.sendEmail(newUser.email, codeId).catch((error) => {
            console.error(error);
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

        const userList = await this.userModel
            .find(filter)
            .skip(skip)
            .limit(pageSize)
            .select('-password')
            .sort(sort as any);

        return { totalPages, userList };
    }

    async findOne(id: string) {
        return await this.userModel.findById(id);
    }

    async findByEmail(email: string) {
        return await this.userModel.findOne({ email });
    }

    async update(updateUserDto: UpdateUserDto) {
        if (updateUserDto.email) {
            const isEmailExisted = await this.userModel.exists({
                email: updateUserDto.email,
                _id: { $ne: updateUserDto._id },
            });

            if (isEmailExisted) {
                throw new BadRequestException('Email already existed');
            }
        }

        return await this.userModel
            .findOneAndUpdate(
                { _id: updateUserDto._id },
                { ...updateUserDto },
                { new: true },
            )
            .select('-password');
    }

    async updateRefreshToken(token: string, _id: string) {
        const expiresIn = this.configService.get<string>(
            'JWT_REFRESH_EXPIRES_IN_DB',
        )!;
        const expiresAt = new Date(Date.now() + ms(expiresIn as StringValue));
        return await this.userModel.updateOne(
            { _id },
            {
                $push: {
                    refreshTokens: {
                        token,
                        expiresAt,
                    },
                },
            },
        );
    }

    async removeRefreshToken(token: string, _id: string) {
        return await this.userModel.updateOne(
            { _id },
            {
                $pull: {
                    refreshTokens: {
                        token,
                    },
                },
            },
        );
    }

    async deleteUser(id: string) {
        return await this.userModel.deleteOne({ _id: id });
    }

    async sendEmail(email: string, code: string) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return await this.mailerService.sendMail({
            to: email,
            subject: 'Welcome!',
            template: 'register',
            context: {
                email: email,
                activationCode: code,
            },
        });
    }

    async activateUser(id: string, code: string) {
        const user = await this.userModel.findById(id).select('-password');
        if (!user) {
            throw new BadRequestException('User not found');
        }
        if (user.isActive) {
            throw new BadRequestException('User is already active');
        }
        if (user.codeId !== code) {
            throw new BadRequestException('Invalid code');
        }
        if (user.codeExpired < new Date()) {
            throw new BadRequestException('Code has expired');
        }
        user.isActive = true;
        user.codeId = '';
        user.codeExpired = new Date();
        return await user.save();
    }

    async reSendCodeActive(email: string) {
        const user = await this.userModel
            .findOne({ email })
            .select('-password');
        if (!user) {
            throw new BadRequestException('User not found');
        }
        if (user.isActive === true) {
            throw new BadRequestException('User is already active');
        }
        const codeId = uuidv4();
        const expireTime =
            this.configService.get<string>('MAIL_CODE_EXPIRE') || '30m';
        user.codeId = codeId;
        user.codeExpired = new Date(Date.now() + ms(expireTime as StringValue));
        await user.save();
        this.sendEmail(user.email, codeId).catch((error) => {
            console.error(error);
        });
        return codeId;
    }
}
