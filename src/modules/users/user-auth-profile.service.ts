/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
    BadRequestException,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';
import { hashPassword } from '@/utils/utils';
import { StatsService } from '../stats/stats.service';
import { USER_MESSAGES } from './constants/user.constant';
import { CreateUserDto } from './dto/create-user.dto';
import { User } from './schemas/user.schema';
import { UserAccountType, UserResponse, UserRole } from './types/user';
import { UserCodeService } from './user-code.service';
import { UserMailService } from './user-mail.service';

@Injectable()
export class UserAuthProfileService {
    constructor(
        @InjectModel(User.name) private userModel: Model<User>,
        private readonly configService: ConfigService,
        private readonly statsService: StatsService,
        private readonly userCodeService: UserCodeService,
        private readonly userMailService: UserMailService,
    ) {}

    private async createBaseUser(params: {
        email: string;
        password: string;
        name?: string;
        role?: UserRole;
        accountType?: UserAccountType;
        hasPassword?: boolean;
        isActive?: boolean;
        phone?: string;
    }) {
        const {
            email,
            password,
            name,
            role = UserRole.USER,
            accountType = UserAccountType.LOCAL,
            hasPassword = true,
            isActive = false,
            phone,
        } = params;

        const newUser = await this.userModel.create({
            email: email.toLowerCase(),
            name: name || email.split('@')[0],
            password,
            phone,
            role,
            accountType,
            hasPassword,
            isActive,
        });

        return newUser;
    }

    /**
     * Tạo tài khoản mới, sinh mã OTP lưu vào Redis và gửi email kích hoạt.
     * Mặc định tài khoản tạo ra sẽ ở trạng thái isActive = false.
     */
    async create(createUserDto: CreateUserDto, creatorRole?: string) {
        // Chặn tạo SUPER_ADMIN ở mọi trường hợp (kể cả gọi qua service)
        if (createUserDto.role === UserRole.SUPER_ADMIN) {
            throw new ForbiddenException(USER_MESSAGES.MISSING_PERMISSION);
        }

        // Chặn tạo ADMIN nếu người tạo không phải là SUPER_ADMIN
        // (creatorRole undefined từ register() cũng sẽ bị chặn)
        if (
            createUserDto.role === UserRole.ADMIN &&
            creatorRole !== UserRole.SUPER_ADMIN
        ) {
            throw new ForbiddenException(USER_MESSAGES.MISSING_PERMISSION);
        }

        const isEmailExisted = await this.userModel.exists({
            email: createUserDto.email,
        });

        if (isEmailExisted) {
            throw new BadRequestException(USER_MESSAGES.EMAIL_EXISTED);
        }

        if (createUserDto.phone) {
            const isPhoneExisted = await this.userModel.exists({
                phone: createUserDto.phone,
            });

            if (isPhoneExisted) {
                throw new BadRequestException(USER_MESSAGES.PHONE_EXISTED);
            }
        }

        const passwordHash = await hashPassword(createUserDto.password);
        const codeActiveId = uuidv4();

        const newUser = await this.createBaseUser({
            email: createUserDto.email,
            password: passwordHash,
            name: createUserDto.name,
            phone: createUserDto.phone,
            role: createUserDto.role,
            accountType: UserAccountType.LOCAL,
            hasPassword: true,
            isActive: false,
        });

        await this.userCodeService.saveCodeRedis(
            newUser._id.toString(),
            codeActiveId,
            'NEW',
        );

        this.userMailService
            .sendEmailActive(newUser.email, codeActiveId)
            .catch((error) => {
                console.error(error);
            });

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password, __v, ...user } = newUser.toObject();

        void this.statsService.incrementNewUser();

        return user as UserResponse;
    }

    /**
     * Helper đăng ký nhanh chỉ với email và password.
     */
    async register(email: string, pass: string) {
        try {
            return await this.create({
                email,
                password: pass,
                confirmPassword: pass,
                role: UserRole.USER,
                name: email.split('@')[0],
            });
        } catch (error) {
            if (
                error instanceof BadRequestException &&
                (error.message === USER_MESSAGES.EMAIL_EXISTED ||
                    error.message === USER_MESSAGES.PHONE_EXISTED)
            ) {
                return USER_MESSAGES.REGISTER_CHECK_EMAIL;
            }
            throw error;
        }
    }

    /**
     * Tạo account local từ Google login khi email chưa tồn tại.
     */
    async createGoogleAccount(email: string, name?: string) {
        const passwordHash = await hashPassword(
            `${email}:${Date.now()}:${uuidv4()}`,
        );

        const newUser = await this.createBaseUser({
            email,
            password: passwordHash,
            name,
            accountType: UserAccountType.GOOGLE,
            hasPassword: false,
            isActive: true,
        });

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password, __v, ...user } = newUser.toObject();
        return user as UserResponse;
    }

    /**
     * Gửi email chứa mã OTP để kích hoạt tài khoản.
     */
    async sendEmailActive(email: string, code: string) {
        return await this.userMailService.sendEmailActive(email, code);
    }

    /**
     * Kích hoạt tài khoản bằng mã OTP do người dùng nhập vào.
     */
    async activateUser(email: string, code: string) {
        const user = await this.userModel
            .findOne({ email })
            .select('_id isActive isDisabled email');
        if (!user || user.isDisabled || user.isActive) {
            throw new BadRequestException(USER_MESSAGES.INVALID_CODE);
        }

        await this.userCodeService.verifyCodeWithRedis(
            this.userCodeService.redisActiveKey(user._id.toString()),
            code,
        );

        user.isActive = true;
        await user.save();
        return USER_MESSAGES.ACTIVE_SUCCESS;
    }

    /**
     * Gửi lại mã OTP kích hoạt tài khoản, có check chống spam (cooldown).
     */
    async reSendCodeActive(email: string) {
        const user = await this.userModel
            .findOne({ email })
            .select('_id isActive isDisabled email')
            .lean();
        if (!user || user.isDisabled === true || user.isActive === true) {
            return 'OK';
        }

        await this.userCodeService.checkMailCooldownRedis(
            this.userCodeService.redisActiveKey(user._id.toString()),
            this.configService.get<string>('MAIL_CODE_ACTIVE_EXPIRE')!,
            GLOBAL_CONSTANTS.COOLDOWN_SECONDS,
        );

        const codeActive = uuidv4();

        // Lưu Redis ĐỒNG BỘ trước
        await this.userCodeService.saveCodeRedis(
            user._id.toString(),
            codeActive,
            'RESEND',
        );

        // Gửi mail bất đồng bộ (fire-and-forget)
        this.userMailService
            .sendEmailActive(user.email, codeActive)
            .catch((error) => {
                console.error(error);
            });
        return 'OK';
    }
}
