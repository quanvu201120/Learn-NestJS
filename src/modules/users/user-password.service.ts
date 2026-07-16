import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';
import {
    ChangePasswordAuthDto,
    CreatePasswordAuthDto,
} from '@/auth/dto/password-auth.dto';
import { formatExpireTime, hashPassword } from '@/utils/utils';
import { USER_MESSAGES } from './constants/user.constant';
import { User } from './schemas/user.schema';
import { UserCodeService } from './user-code.service';
import { UserMailService } from './user-mail.service';
import { UserQueryService } from './user-query.service';
import { UserAccountType } from './types/user';

@Injectable()
export class UserPasswordService {
    constructor(
        @InjectModel(User.name) private userModel: Model<User>,
        private readonly configService: ConfigService,
        private readonly userCodeService: UserCodeService,
        private readonly userMailService: UserMailService,
        private readonly userQueryService: UserQueryService,
    ) {}

    /**
     * Äá»•i máº­t kháº©u (cÃ³ kiá»ƒm tra máº­t kháº©u cÅ©).
     */
    async updatePassword(
        id: string,
        changePasswordAuthDto: ChangePasswordAuthDto,
    ) {
        const { existingUser } = await this.userQueryService.checkUser(id);
        if (existingUser.hasPassword === false) {
            throw new BadRequestException(USER_MESSAGES.PASSWORD_NOT_SET);
        }
        const { passwordOld, passwordNew } = changePasswordAuthDto;
        const isPasswordMatched = await bcrypt.compare(
            passwordOld,
            existingUser.password,
        );
        if (!isPasswordMatched) {
            throw new BadRequestException(USER_MESSAGES.INVALID_PASSWORD);
        }

        const passwordNewHash = await hashPassword(passwordNew);

        existingUser.password = passwordNewHash;
        await existingUser.save();
        return USER_MESSAGES.CHANGE_PASSWORD_SUCCESS;
    }

    /**
     * Táº¡o máº­t kháº©u láº§n Ä‘áº§u (cho tÃ i khoáº£n google).
     */
    async createPassword(
        id: string,
        createPasswordAuthDto: CreatePasswordAuthDto,
    ) {
        const { existingUser } = await this.userQueryService.checkUser(id);
        if (
            existingUser.hasPassword !== false &&
            existingUser.accountType === UserAccountType.GOOGLE
        ) {
            throw new BadRequestException(USER_MESSAGES.PASSWORD_ALREADY_SET);
        }

        const passwordHash = await hashPassword(createPasswordAuthDto.password);

        existingUser.password = passwordHash;
        existingUser.hasPassword = true;
        await existingUser.save();
        return USER_MESSAGES.CREATE_PASSWORD_SUCCESS;
    }

    /**
     * Gá»­i mail cáº¥p mÃ£ OTP khÃ´i phá»¥c máº­t kháº©u.
     */
    async sendMailForgotPassword(email: string) {
        const user = await this.userModel
            .findOne({ email })
            .select('_id isDisabled hasPassword')
            .lean();
        if (!user) {
            throw new BadRequestException(USER_MESSAGES.EMAIL_NOT_FOUND);
        }
        if (user.isDisabled) {
            throw new BadRequestException(USER_MESSAGES.USER_DISABLED);
        }

        if (user.hasPassword === false) {
            throw new BadRequestException(USER_MESSAGES.PASSWORD_NOT_SET);
        }

        await this.userCodeService.checkMailCooldownRedis(
            this.userCodeService.redisForgotKey(user._id.toString()),
            this.configService.get<string>('MAIL_CODE_FORGOT_EXPIRE')!,
            GLOBAL_CONSTANTS.COOLDOWN_SECONDS,
        );

        const codeForgotId = uuidv4();
        await this.userCodeService.saveCodeRedis(
            user._id.toString(),
            codeForgotId,
            'FORGOT',
        );
        const expireTime = this.configService.get<string>(
            'MAIL_CODE_FORGOT_EXPIRE',
        )!;
        const expireTimeFormatted = formatExpireTime(expireTime);
        this.userMailService
            .sendEmailViaResend(
                email,
                'Forgot Password!',
                this.configService.get<string>('MAIL_FORGOT_TEMPLATE') ||
                    'forgot-password',
                {
                    email: email,
                    activationCode: codeForgotId,
                    expireTime: expireTimeFormatted,
                },
            )
            .catch((error) => {
                console.error(error);
            });
        return 'OK';
    }

    /**
     * Äáº·t láº¡i máº­t kháº©u má»›i thÃ´ng qua mÃ£ OTP tá»« mail.
     */
    async resetPassword(email: string, code: string, password: string) {
        const user = await this.userModel
            .findOne({ email })
            .select('_id password isDisabled hasPassword');
        if (!user) {
            throw new BadRequestException(USER_MESSAGES.EMAIL_NOT_FOUND);
        }
        if (user.isDisabled) {
            throw new BadRequestException(USER_MESSAGES.USER_DISABLED);
        }
        if (user.hasPassword === false) {
            throw new BadRequestException(USER_MESSAGES.PASSWORD_NOT_SET);
        }

        await this.userCodeService.verifyCodeWithRedis(
            this.userCodeService.redisForgotKey(user._id.toString()),
            code,
        );

        const passwordHash = await hashPassword(password);
        user.password = passwordHash;

        await user.save();
        return USER_MESSAGES.RESET_PASSWORD_SUCCESS;
    }

    /**
     * XÃ¡c nháº­n máº­t kháº©u
     */
    async confirmPassword(userId: string, password: string) {
        const { existingUser } = await this.userQueryService.checkUser(userId);
        if (existingUser.hasPassword === false) {
            throw new BadRequestException(USER_MESSAGES.PASSWORD_NOT_SET);
        }

        const isPasswordValid = await bcrypt.compare(
            password,
            existingUser.password,
        );
        if (!isPasswordValid) {
            throw new BadRequestException(USER_MESSAGES.PASSWORD_NOT_MATCH);
        }
        return true;
    }
}
