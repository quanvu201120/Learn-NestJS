/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { User } from './schemas/user.schema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import {
    hashPassword,
    formatExpireTime,
    checkMailCooldown,
    hashCodeVerifyEmail,
} from '@/utils/utils';
import aqp from 'api-query-params';
import { UpdateUserDto } from './dto/update-user.dto copy';
import { ConfigService } from '@nestjs/config';
import ms, { StringValue } from 'ms';
import { v4 as uuidv4 } from 'uuid';
import { MailerService } from '@nestjs-modules/mailer';
import bcrypt from 'bcrypt';
import { ChangePasswordAuthDto } from '@/auth/dto/password-auth.dto';
import { RedisService } from '@/redis/redis.service';
import { ActionRedis, COOLDOWN_SECONDS } from '@/utils/contans';

@Injectable()
export class UsersService {
    constructor(
        @InjectModel(User.name) private userModel: Model<User>,
        private configService: ConfigService,
        private readonly mailerService: MailerService,
        private readonly redisService: RedisService,
    ) {}
    async create(createUserDto: CreateUserDto) {
        const isEmailExisted = await this.userModel.exists({
            email: createUserDto.email,
        });

        if (isEmailExisted) {
            throw new BadRequestException('Email already existed');
        }

        const passwordHash = await hashPassword(createUserDto.password);
        const codeActiveId = uuidv4();

        const newUser = await this.userModel.create({
            ...createUserDto,
            password: passwordHash,
            isActive: false,
        });

        // Lưu Redis ĐỒNG BỘ trước để tránh race condition với email gửi nền
        await this.saveCodeRedis(newUser._id.toString(), codeActiveId, 'NEW');

        // Gửi mail bất đồng bộ (fire-and-forget)
        this.sendEmailActive(newUser.email, codeActiveId).catch((error) => {
            console.error(error);
        });

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password, __v, ...user } = newUser.toObject();
        return user;
    }

    async register(email: string, pass: string) {
        const isEmailExisted = await this.userModel.exists({
            email,
        });

        if (isEmailExisted) {
            throw new BadRequestException('Email already existed');
        }

        const passHash = await hashPassword(pass);
        const codeActiveId = uuidv4();

        const newUser = await this.userModel.create({
            email,
            password: passHash,
            role: 'USER',
            isActive: false,
        });

        // Lưu Redis ĐỒNG BỘ trước để tránh race condition với email gửi nền
        await this.saveCodeRedis(newUser._id.toString(), codeActiveId, 'NEW');

        // Gửi mail bất đồng bộ (fire-and-forget)
        this.sendEmailActive(newUser.email, codeActiveId).catch((error) => {
            console.error(error);
        });

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password, __v, ...user } = newUser.toObject();
        return user;
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

    async sendEmailActive(email: string, code: string) {
        const rawExpire = this.configService.get<string>(
            'MAIL_CODE_ACTIVE_EXPIRE',
        )!;
        const expireTime = formatExpireTime(rawExpire);

        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return await this.mailerService.sendMail({
            to: email,
            subject: 'Welcome!',
            template:
                this.configService.get<string>('MAIL_REGISTER_TEMPLATE') ||
                'register',
            context: {
                email: email,
                activationCode: code,
                expireTime: expireTime,
            },
        });
    }

    async activateUser(email: string, code: string) {
        const user = await this.userModel
            .findOne({ email })
            .select('_id isActive email');
        if (!user) {
            throw new BadRequestException('User not found');
        }
        if (user.isActive) {
            throw new BadRequestException('User is already active');
        }

        await this.verifyCodeWithRedis(
            this.redisActiveKey(user._id.toString()),
            code,
        );

        user.isActive = true;
        return await user.save();
    }

    private async verifyCodeWithRedis(keyRedis: string, code: string) {
        const redisCodeActive = await this.redisService.get(keyRedis);

        if (!redisCodeActive) {
            throw new BadRequestException('Code has expired');
        }

        const hashCode = hashCodeVerifyEmail(
            code,
            this.configService.get<string>('CODE_VERIFY_PEPPER')!,
        );

        if (hashCode !== redisCodeActive) {
            throw new BadRequestException('Invalid code');
        }

        await this.redisService.del(keyRedis);
    }

    async reSendCodeActive(email: string) {
        const user = await this.userModel
            .findOne({ email })
            .select('_id isActive email')
            .lean();
        if (!user) {
            throw new BadRequestException('User not found');
        }
        if (user.isActive === true) {
            throw new BadRequestException('User is already active');
        }

        const codeActive = uuidv4();

        // Lưu Redis ĐỒNG BỘ trước (bao gồm check cooldown)
        await this.saveCodeRedis(user._id.toString(), codeActive, 'RESEND');

        // Gửi mail bất đồng bộ (fire-and-forget)
        this.sendEmailActive(user.email, codeActive).catch((error) => {
            console.error(error);
        });
        return 'OK';
    }

    async updatePassword(
        id: string,
        changePasswordAuthDto: ChangePasswordAuthDto,
    ) {
        const { passwordOld, passwordNew } = changePasswordAuthDto;
        const user = await this.userModel.findById(id);
        if (!user) {
            throw new BadRequestException('User not found');
        }
        const isPasswordMatched = await bcrypt.compare(
            passwordOld,
            user.password,
        );
        if (!isPasswordMatched) {
            throw new BadRequestException('Invalid password');
        }

        const passwordNewHash = await hashPassword(passwordNew);

        user.password = passwordNewHash;
        await user.save();
        return {
            _id: user._id,
            email: user.email,
            message: 'Change password successfully',
        };
    }

    async sendMailForgotPassword(email: string) {
        const user = await this.userModel
            .findOne({ email })
            .select('_id')
            .lean();
        if (!user) {
            throw new BadRequestException('Email not found');
        }

        await this.checkMailCooldownRedis(
            this.redisForgotKey(user._id.toString()),
            this.configService.get<string>('MAIL_CODE_FORGOT_EXPIRE')!,
            COOLDOWN_SECONDS,
        );

        const codeForgotId = uuidv4();
        await this.saveCodeRedis(user._id.toString(), codeForgotId, 'FORGOT');
        const expireTime = this.configService.get<string>(
            'MAIL_CODE_FORGOT_EXPIRE',
        )!;
        const expireTimeFormatted = formatExpireTime(expireTime);
        this.mailerService
            .sendMail({
                to: email,
                subject: 'Forgot Password!',
                template:
                    this.configService.get<string>('MAIL_FORGOT_TEMPLATE') ||
                    'forgot-password',
                context: {
                    email: email,
                    activationCode: codeForgotId,
                    expireTime: expireTimeFormatted,
                },
            })
            .catch((error) => {
                console.error(error);
            });
        return 'OK';
    }

    async resetPassword(email: string, code: string, password: string) {
        const user = await this.userModel
            .findOne({ email })
            .select('_id password');
        if (!user) {
            throw new BadRequestException('Email not found');
        }

        await this.verifyCodeWithRedis(
            this.redisForgotKey(user._id.toString()),
            code,
        );

        const passwordHash = await hashPassword(password);
        user.password = passwordHash;

        await user.save();
        return 'Reset password successfully';
    }

    private redisActiveKey(userId: string) {
        return `auth:active:${userId}`;
    }

    private redisForgotKey(userId: string) {
        return `auth:forgot:${userId}`;
    }

    private async checkMailCooldownRedis(
        key: string,
        expireDurationStr: string,
        cooldownSeconds: number,
    ) {
        const remainingTTL = await this.redisService.ttl(key);
        if (remainingTTL < 0) return;

        const expireSeconds = ms(expireDurationStr as StringValue) / 1000;
        const timeElapsed = expireSeconds - remainingTTL;

        if (timeElapsed < cooldownSeconds) {
            const waitTime = Math.ceil(cooldownSeconds - timeElapsed);
            throw new BadRequestException(
                `Vui lòng đợi ${waitTime} giây trước khi yêu cầu gửi lại mã mới.`,
            );
        }
    }

    private async saveCodeRedis(
        id: string,
        codeActive: string,
        type: ActionRedis,
    ) {
        const keyRedis =
            type === 'FORGOT'
                ? this.redisForgotKey(id)
                : this.redisActiveKey(id);
        const expireTime = this.configService.get<string>(
            type === 'FORGOT'
                ? 'MAIL_CODE_FORGOT_EXPIRE'
                : 'MAIL_CODE_ACTIVE_EXPIRE',
        )!;
        if (type === 'RESEND') {
            await this.checkMailCooldownRedis(
                keyRedis,
                expireTime,
                COOLDOWN_SECONDS,
            );
        }
        const expireTimeSeconds = ms(expireTime as StringValue) / 1000;
        const hashCode = hashCodeVerifyEmail(
            codeActive,
            this.configService.get<string>('CODE_VERIFY_PEPPER')!,
        );
        await this.redisService.setWithTTL(
            keyRedis,
            hashCode,
            expireTimeSeconds,
        );
    }
}
