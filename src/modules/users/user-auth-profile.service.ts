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
     * Táº¡o tÃ i khoáº£n má»›i, sinh mÃ£ OTP lÆ°u vÃ o Redis vÃ  gá»­i email kÃ­ch hoáº¡t.
     * Máº·c Ä‘á»‹nh tÃ i khoáº£n táº¡o ra sáº½ á»Ÿ tráº¡ng thÃ¡i isActive = false.
     */
    async create(createUserDto: CreateUserDto, creatorRole?: string) {
        // Cháº·n táº¡o SUPER_ADMIN á»Ÿ má»i trÆ°á»ng há»£p (ká»ƒ cáº£ gá»i qua service)
        if (createUserDto.role === UserRole.SUPER_ADMIN) {
            throw new ForbiddenException(USER_MESSAGES.MISSING_PERMISSION);
        }

        // Cháº·n táº¡o ADMIN náº¿u ngÆ°á»i táº¡o khÃ´ng pháº£i lÃ  SUPER_ADMIN
        // (creatorRole undefined tá»« register() cÅ©ng sáº½ bá»‹ cháº·n)
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
     * Helper Ä‘Äƒng kÃ½ nhanh chá»‰ vá»›i email vÃ  password.
     */
    async register(email: string, pass: string) {
        return this.create({
            email,
            password: pass,
            confirmPassword: pass,
            role: UserRole.USER,
            name: email.split('@')[0],
        });
    }

    /**
     * Táº¡o account local tá»« Google login khi email chÆ°a tá»“n táº¡i.
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
     * Gá»­i email chá»©a mÃ£ OTP Ä‘á»ƒ kÃ­ch hoáº¡t tÃ i khoáº£n.
     */
    async sendEmailActive(email: string, code: string) {
        return await this.userMailService.sendEmailActive(email, code);
    }

    /**
     * KÃ­ch hoáº¡t tÃ i khoáº£n báº±ng mÃ£ OTP do ngÆ°á»i dÃ¹ng nháº­p vÃ o.
     */
    async activateUser(email: string, code: string) {
        const user = await this.userModel
            .findOne({ email })
            .select('_id isActive isDisabled email');
        if (!user) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }
        if (user.isDisabled) {
            throw new BadRequestException(USER_MESSAGES.USER_DISABLED);
        }
        if (user.isActive) {
            throw new BadRequestException(USER_MESSAGES.USER_ALREADY_ACTIVE);
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
     * Gá»­i láº¡i mÃ£ OTP kÃ­ch hoáº¡t tÃ i khoáº£n, cÃ³ check chá»‘ng spam (cooldown).
     */
    async reSendCodeActive(email: string) {
        const user = await this.userModel
            .findOne({ email })
            .select('_id isActive isDisabled email')
            .lean();
        if (!user) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }
        if (user.isDisabled === true) {
            throw new BadRequestException(USER_MESSAGES.USER_DISABLED);
        }
        if (user.isActive === true) {
            throw new BadRequestException(USER_MESSAGES.USER_ALREADY_ACTIVE);
        }

        await this.userCodeService.checkMailCooldownRedis(
            this.userCodeService.redisActiveKey(user._id.toString()),
            this.configService.get<string>('MAIL_CODE_ACTIVE_EXPIRE')!,
            GLOBAL_CONSTANTS.COOLDOWN_SECONDS,
        );

        const codeActive = uuidv4();

        // LÆ°u Redis Äá»’NG Bá»˜ trÆ°á»›c
        await this.userCodeService.saveCodeRedis(
            user._id.toString(),
            codeActive,
            'RESEND',
        );

        // Gá»­i mail báº¥t Ä‘á»“ng bá»™ (fire-and-forget)
        this.userMailService
            .sendEmailActive(user.email, codeActive)
            .catch((error) => {
                console.error(error);
            });
        return 'OK';
    }
}
