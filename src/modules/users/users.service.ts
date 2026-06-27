/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */

/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { USER_MESSAGES } from './constants/user.constant';
import {
    BadRequestException,
    forwardRef,
    Inject,
    Injectable,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { User } from './schemas/user.schema';
import { Connection, Model, Types } from 'mongoose';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
    hashPassword,
    formatExpireTime,
    hashCodeVerifyEmail,
    validateObjectId,
    toObjectId,
} from '@/utils/utils';
import aqp from 'api-query-params';
import { UpdateUserByAdminDto, UpdateUserDto } from './dto/update-user.dto';
import { ConfigService } from '@nestjs/config';
import ms, { StringValue } from 'ms';
import { v4 as uuidv4 } from 'uuid';
import { Subject } from 'rxjs';
import bcrypt from 'bcrypt';
import { ChangePasswordAuthDto } from '@/auth/dto/password-auth.dto';
import { RedisService } from '@/redis/redis.service';
import {
    ActionRedis,
    GLOBAL_CONSTANTS,
} from '@/common/constants/global.constant';
import * as fs from 'fs';
import * as path from 'path';
import handlebars from 'handlebars';
import { UserDisableStateResponse, UserResponse } from './types/user';
import { MediaService } from '../media/media.service';
import {
    MEDIA_CONSTANTS,
    MEDIA_MESSAGES,
} from '../media/constants/media.constant';
import { Media } from '../media/schemas/media.schema';
import { OwnerTypeEnum } from '../media/types/media';
import { serializeUser } from './utils/user.serializer';
import { SessionService } from '../session/session.service';
import {
    CleanupJobEntityEnum,
    CleanupJobResourceEnum,
} from '../cleanup-jobs/types/cleanup-job';
import { RelationshipsService } from '../relationships/relationships.service';

@Injectable()
export class UsersService {
    public readonly userDisabled$ = new Subject<{ userId: string }>();

    constructor(
        @InjectModel(User.name) private userModel: Model<User>,
        @InjectConnection() private readonly connection: Connection,
        private configService: ConfigService,
        private readonly redisService: RedisService,
        private readonly mediaService: MediaService,
        private readonly sessionService: SessionService,
        @Inject(forwardRef(() => RelationshipsService))
        private readonly relationshipsService: RelationshipsService,
    ) {}

    /**
     * Chuẩn hóa dữ liệu avatar lồng bên trong trước khi trả object user về cho client.
     */
    private serializeUserResponse(user: UserResponse | null) {
        if (!user) {
            return user;
        }

        return serializeUser(user, false) as UserResponse;
    }

    /**
     * Tạo tài khoản mới, sinh mã OTP lưu vào Redis và gửi email kích hoạt.
     * Mặc định tài khoản tạo ra sẽ ở trạng thái isActive = false.
     */
    async create(createUserDto: CreateUserDto) {
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

        const newUser = await this.userModel.create({
            ...createUserDto,
            password: passwordHash,
            isActive: false,
        });

        await this.saveCodeRedis(newUser._id.toString(), codeActiveId, 'NEW');

        this.sendEmailActive(newUser.email, codeActiveId).catch((error) => {
            console.error(error);
        });

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password, __v, ...user } = newUser.toObject();
        return user as UserResponse;
    }

    /**
     * Helper đăng ký nhanh chỉ với email và password.
     */
    async register(email: string, pass: string) {
        return this.create({
            email,
            password: pass,
            confirmPassword: pass,
            role: 'USER',
            name: email.split('@')[0],
        } as CreateUserDto);
    }

    /**
     * Lấy danh sách user có hỗ trợ phân trang và filter (thường dùng cho Admin dashboard).
     */
    async findAll(query: string, current: number, pageSize: number) {
        const { filter, sort } = aqp(query);
        if (filter.current) delete filter.current;
        if (filter.pageSize) delete filter.pageSize;

        if (!current) current = 1;
        if (!pageSize) pageSize = 10;

        const totalItems = (await this.userModel.find(filter)).length;
        const totalPages = Math.ceil(totalItems / pageSize);
        const skip = (current - 1) * pageSize;

        const users: UserResponse[] = await this.userModel
            .find(filter)
            .skip(skip)
            .limit(pageSize)
            .select('-password -__v')
            .populate('avatar', '-__v')
            .sort(sort as any)
            .lean();

        return {
            totalPages,
            users: users.map((user) => this.serializeUserResponse(user)),
        };
    }

    /**
     * Lấy thông tin user an toàn (không chứa password), trả về plain object (lean) để API response.
     */
    async findOneForApi(id: string) {
        validateObjectId(id, 'user id');
        const user = (await this.userModel
            .findById(id)
            .select('-password -__v')
            .populate('avatar', '-__v')
            .lean()) as UserResponse;

        return this.serializeUserResponse(user);
    }

    /**
     * Lấy Mongoose Document của user theo ID (dùng cho logic nội bộ cần gọi .save()).
     */
    async findOne(id: string) {
        validateObjectId(id, 'user id');
        return await this.userModel.findById(id);
    }

    /**
     * Tìm kiếm user bằng email hoặc số điện thoại
     */
    async findOneByEmailOrPhone(userId: string, search: string) {
        const { existingUser: currentUser } = await this.checkUser(userId);

        const query = search.trim();
        const isEmail = query.includes('@');

        const filter = isEmail
            ? { email: query.toLowerCase() }
            : { phone: query };

        const searchUser = (await this.userModel
            .findOne({
                ...filter,
                _id: { $ne: userId },
                isDisabled: false,
                isActive: true,
            })
            .select('-password -__v')
            .populate('avatar', '-__v')
            .lean()) as UserResponse;

        if (!searchUser) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }

        const relationshipBlock =
            await this.relationshipsService.checkIsBlocked(
                currentUser._id.toString(),
                searchUser._id.toString(),
            );

        if (
            relationshipBlock &&
            relationshipBlock.blockedBy &&
            relationshipBlock.blockedBy.toString() !==
                currentUser._id.toString()
        ) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }

        return this.serializeUserResponse(searchUser);
    }

    /**
     * Tìm user bằng email hoặc số điện thoại (thường dùng trong xác thực Login).
     */
    async findByEmailOrPhoneForLogin(identifier: string) {
        const isEmail = identifier.includes('@');
        const filter = isEmail ? { email: identifier } : { phone: identifier };
        return await this.userModel.findOne(filter);
    }

    /**
     * Helper chuyển trạng thái disable/enable và xử lý session liên quan.
     */
    private async setDisabledState(
        userId: string,
        isDisabled: boolean,
    ): Promise<UserDisableStateResponse> {
        validateObjectId(userId, 'user id');
        const user = await this.userModel.findById(userId);
        if (!user) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }

        if (isDisabled && user.isDisabled) {
            throw new BadRequestException(USER_MESSAGES.USER_ALREADY_DISABLED);
        }

        if (!isDisabled && !user.isDisabled) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_DISABLED);
        }

        if (isDisabled && user.role === 'ADMIN') {
            throw new BadRequestException(USER_MESSAGES.CANNOT_DISABLE_ADMIN);
        }

        user.isDisabled = isDisabled;
        user.disabledAt = isDisabled ? new Date() : undefined;

        if (isDisabled) {
            user.tokenVersion += 1;
        }

        await user.save();

        if (isDisabled) {
            await this.sessionService.revokeAllByUserIdWithCleanup(userId);
            this.userDisabled$.next({ userId });
            return {
                message: USER_MESSAGES.DISABLE_SUCCESS,
                isDisabled: true,
            };
        }

        return {
            message: USER_MESSAGES.ENABLE_SUCCESS,
            isDisabled: false,
        };
    }

    /**
     * Cập nhật thông tin cá nhân của user hiện tại.
     */
    async update(updateUserDto: UpdateUserDto, currentUser: string) {
        validateObjectId(currentUser, 'user id');

        const user = await this.userModel.findById(currentUser).lean();
        if (!user) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }

        if (user.isDisabled) {
            throw new BadRequestException(USER_MESSAGES.USER_DISABLED);
        }

        const normalizedEntries = Object.entries(updateUserDto).filter(
            ([, value]) => value !== undefined,
        );

        if ('name' in updateUserDto) {
            const name = updateUserDto.name?.trim();
            if (!name) {
                throw new BadRequestException('Name must not be empty');
            }
        }

        if (updateUserDto.phone) {
            const isPhoneExisted = await this.userModel.exists({
                phone: updateUserDto.phone,
                _id: { $ne: currentUser },
            });

            if (isPhoneExisted) {
                throw new BadRequestException(USER_MESSAGES.PHONE_EXISTED);
            }
        }

        const $set = Object.fromEntries(
            normalizedEntries.filter(([, value]) => value !== null),
        );
        const $unset = Object.fromEntries(
            normalizedEntries
                .filter(([, value]) => value === null)
                .map(([key]) => [key, '']),
        );
        const updateQuery: {
            $set?: Record<string, unknown>;
            $unset?: Record<string, unknown>;
        } = {};

        if (Object.keys($set).length > 0) {
            updateQuery.$set = $set;
        }

        if (Object.keys($unset).length > 0) {
            updateQuery.$unset = $unset;
        }

        const updatedUser = await this.userModel
            .findByIdAndUpdate(currentUser, updateQuery, { new: true })
            .select('-password -__v')
            .populate('avatar', '-__v')
            .lean();

        if (!updatedUser) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }

        return this.serializeUserResponse(updatedUser as UserResponse);
    }

    /**
     * Cập nhật thông tin user cho ADMIN.
     */
    async updateByAdmin(userId: string, updateUserDto: UpdateUserByAdminDto) {
        validateObjectId(userId, 'user id');

        const user = await this.userModel.findById(userId);
        if (!user) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }
        if (user.isDisabled) {
            throw new BadRequestException(USER_MESSAGES.USER_DISABLED);
        }

        if (updateUserDto.email) {
            const isEmailExisted = await this.userModel.exists({
                email: updateUserDto.email,
                _id: { $ne: userId },
            });

            if (isEmailExisted) {
                throw new BadRequestException(USER_MESSAGES.EMAIL_EXISTED);
            }
        }

        if (updateUserDto.phone) {
            const isPhoneExisted = await this.userModel.exists({
                phone: updateUserDto.phone,
                _id: { $ne: userId },
            });

            if (isPhoneExisted) {
                throw new BadRequestException(USER_MESSAGES.PHONE_EXISTED);
            }
        }

        const normalizedEntries = Object.entries(updateUserDto).filter(
            ([key, value]) => key !== '_id' && value !== undefined,
        );
        const $set = Object.fromEntries(
            normalizedEntries.filter(([, value]) => value !== null),
        );
        const $unset = Object.fromEntries(
            normalizedEntries
                .filter(([, value]) => value === null)
                .map(([key]) => [key, '']),
        );
        const updateQuery: {
            $set?: Record<string, unknown>;
            $unset?: Record<string, unknown>;
        } = {};

        if (Object.keys($set).length > 0) {
            updateQuery.$set = $set;
        }

        if (Object.keys($unset).length > 0) {
            updateQuery.$unset = $unset;
        }

        const updatedUser = await this.userModel
            .findByIdAndUpdate(userId, updateQuery, { new: true })
            .select('-password -__v')
            .populate('avatar', '-__v')
            .lean();

        if (!updatedUser) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }

        return this.serializeUserResponse(updatedUser as UserResponse);
    }

    /**
     * Vô hiệu hóa chính tài khoản của mình.
     */
    async disableSelf(userId: string): Promise<UserDisableStateResponse> {
        return this.setDisabledState(userId, true);
    }

    /**
     * Vô hiệu hóa tài khoản của người khác bởi Admin.
     */
    async disableUserByAdmin(
        userId: string,
        currentUserId: string,
    ): Promise<UserDisableStateResponse> {
        await this.checkUser(currentUserId);
        return this.setDisabledState(userId, true);
    }

    /**
     * Kích hoạt lại tài khoản đã bị vô hiệu hóa bởi Admin.
     */
    async enableUserByAdmin(
        userId: string,
        currentUserId: string,
    ): Promise<UserDisableStateResponse> {
        validateObjectId(currentUserId, 'current user id');
        await this.checkUser(currentUserId);
        if (userId === currentUserId) {
            throw new BadRequestException(USER_MESSAGES.CANNOT_ENABLE_SELF);
        }
        return this.setDisabledState(userId, false);
    }

    /**
     * Gửi email chứa mã OTP để kích hoạt tài khoản.
     */
    async sendEmailActive(email: string, code: string) {
        const rawExpire = this.configService.get<string>(
            'MAIL_CODE_ACTIVE_EXPIRE',
        )!;
        const expireTime = formatExpireTime(rawExpire);

        return await this.sendEmailViaResend(
            email,
            'Welcome!',
            this.configService.get<string>('MAIL_REGISTER_TEMPLATE') ||
                'register',
            {
                email: email,
                activationCode: code,
                expireTime: expireTime,
            },
        );
    }

    /**
     * Kích hoạt tài khoản bằng mã OTP do người dùng nhập vào.
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

        await this.verifyCodeWithRedis(
            this.redisActiveKey(user._id.toString()),
            code,
        );

        user.isActive = true;
        await user.save();
        return USER_MESSAGES.ACTIVE_SUCCESS;
    }

    /**
     * Hàm helper: Kiểm tra mã OTP gửi lên so với mã OTP đã hash lưu trong Redis.
     */
    private async verifyCodeWithRedis(keyRedis: string, code: string) {
        const redisCodeActive = await this.redisService.get(keyRedis);

        if (!redisCodeActive) {
            throw new BadRequestException(USER_MESSAGES.CODE_EXPIRED);
        }

        const hashCode = hashCodeVerifyEmail(
            code,
            this.configService.get<string>('CODE_VERIFY_PEPPER')!,
        );

        if (hashCode !== redisCodeActive) {
            throw new BadRequestException(USER_MESSAGES.INVALID_CODE);
        }

        await this.redisService.del(keyRedis);
    }

    /**
     * Gửi lại mã OTP kích hoạt tài khoản, có check chống spam (cooldown).
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

        await this.checkMailCooldownRedis(
            this.redisActiveKey(user._id.toString()),
            this.configService.get<string>('MAIL_CODE_ACTIVE_EXPIRE')!,
            GLOBAL_CONSTANTS.COOLDOWN_SECONDS,
        );

        const codeActive = uuidv4();

        // Lưu Redis ĐỒNG BỘ trước
        await this.saveCodeRedis(user._id.toString(), codeActive, 'RESEND');

        // Gửi mail bất đồng bộ (fire-and-forget)
        this.sendEmailActive(user.email, codeActive).catch((error) => {
            console.error(error);
        });
        return 'OK';
    }

    /**
     * Đổi mật khẩu dựa vào mật khẩu cũ (khi user đã login).
     */
    async updatePassword(
        id: string,
        changePasswordAuthDto: ChangePasswordAuthDto,
    ) {
        const { existingUser } = await this.checkUser(id);
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
     * Gửi mail cấp mã OTP khôi phục mật khẩu.
     */
    async sendMailForgotPassword(email: string) {
        const user = await this.userModel
            .findOne({ email })
            .select('_id isDisabled')
            .lean();
        if (!user) {
            throw new BadRequestException(USER_MESSAGES.EMAIL_NOT_FOUND);
        }
        if (user.isDisabled) {
            throw new BadRequestException(USER_MESSAGES.USER_DISABLED);
        }

        await this.checkMailCooldownRedis(
            this.redisForgotKey(user._id.toString()),
            this.configService.get<string>('MAIL_CODE_FORGOT_EXPIRE')!,
            GLOBAL_CONSTANTS.COOLDOWN_SECONDS,
        );

        const codeForgotId = uuidv4();
        await this.saveCodeRedis(user._id.toString(), codeForgotId, 'FORGOT');
        const expireTime = this.configService.get<string>(
            'MAIL_CODE_FORGOT_EXPIRE',
        )!;
        const expireTimeFormatted = formatExpireTime(expireTime);
        this.sendEmailViaResend(
            email,
            'Forgot Password!',
            this.configService.get<string>('MAIL_FORGOT_TEMPLATE') ||
                'forgot-password',
            {
                email: email,
                activationCode: codeForgotId,
                expireTime: expireTimeFormatted,
            },
        ).catch((error) => {
            console.error(error);
        });
        return 'OK';
    }

    /**
     * Đặt lại mật khẩu mới thông qua mã OTP từ mail.
     */
    async resetPassword(email: string, code: string, password: string) {
        const user = await this.userModel
            .findOne({ email })
            .select('_id password isDisabled');
        if (!user) {
            throw new BadRequestException(USER_MESSAGES.EMAIL_NOT_FOUND);
        }
        if (user.isDisabled) {
            throw new BadRequestException(USER_MESSAGES.USER_DISABLED);
        }

        await this.verifyCodeWithRedis(
            this.redisForgotKey(user._id.toString()),
            code,
        );

        const passwordHash = await hashPassword(password);
        user.password = passwordHash;

        await user.save();
        return USER_MESSAGES.RESET_PASSWORD_SUCCESS;
    }

    /**
     * Helper: Format Redis key cho OTP Active.
     */
    private redisActiveKey(userId: string) {
        return `auth:active:${userId}`;
    }

    /**
     * Helper: Format Redis key cho OTP Forgot Password.
     */
    private redisForgotKey(userId: string) {
        return `auth:forgot:${userId}`;
    }

    /**
     * Helper: Format Redis key cho OTP Update Email.
     */
    private redisUpdateEmailKey(userId: string, email: string) {
        return `auth:update-email:${userId}:${email}`;
    }

    /**
     * Hàm helper: Check cooldown để tránh spam gửi mail (giới hạn 1 email / X giây).
     */
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
                USER_MESSAGES.PLEASE_WAIT_COOLDOWN(waitTime),
            );
        }
    }

    /**
     * Hàm helper: Sinh OTP, hash rồi lưu xuống Redis kèm theo thời hạn sống (TTL).
     */
    private async saveCodeRedis(
        id: string,
        codeActive: string,
        type: ActionRedis,
        email: string = '',
    ) {
        const keyRedis =
            type === 'FORGOT'
                ? this.redisForgotKey(id)
                : type === 'UPDATE_EMAIL'
                  ? this.redisUpdateEmailKey(id, email)
                  : this.redisActiveKey(id);
        const expireTime = this.configService.get<string>(
            type === 'FORGOT'
                ? 'MAIL_CODE_FORGOT_EXPIRE'
                : type === 'UPDATE_EMAIL'
                  ? 'MAIL_CODE_UPDATE_EMAIL_EXPIRE'
                  : 'MAIL_CODE_ACTIVE_EXPIRE',
        )!;
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

    /**
     * Hàm helper: Render template HTML (Handlebars) và gửi email qua Resend HTTP API.
     */
    private async sendEmailViaResend(
        to: string,
        subject: string,
        templateName: string,
        context: any,
    ) {
        try {
            const templatePath = path.join(
                __dirname,
                '..',
                '..',
                'mail',
                'template',
                `${templateName}.hbs`,
            );
            const templateSource = fs.readFileSync(templatePath, 'utf-8');
            const compiledTemplate = handlebars.compile(templateSource);
            const htmlContent = compiledTemplate(context);

            const resendApiKey =
                this.configService.get<string>('RESEND_API_KEY');
            const mailFrom =
                this.configService.get<string>('MAIL_FROM') ||
                'onboarding@resend.dev';

            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${resendApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from: mailFrom,
                    to,
                    subject,
                    html: htmlContent,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('❌ Resend API Error Details:', errorData);
                throw new Error(
                    `Resend API failed with status ${response.status}`,
                );
            }

            return await response.json();
        } catch (error) {
            console.error('❌ Failed to send email via Resend:', error);
            throw error;
        }
    }

    /**
     * Đếm số lượng user ID thực sự tồn tại trong DB, dùng khi tạo group chat kiểm tra mảng ID truyền vào có hợp lệ không.
     */
    async countUserIdsExist(objectUserIds: Types.ObjectId[]) {
        return await this.userModel.countDocuments({
            _id: { $in: objectUserIds },
            isDisabled: false,
        });
    }

    /**
     * Cập nhật thời gian online cuối cùng của user.
     */
    async setLastOnline(userId: string) {
        const { objectUserId } = await this.checkUser(userId);
        return await this.userModel.updateOne(
            { _id: objectUserId },
            { $set: { lastOnlineAt: new Date() } },
        );
    }

    /**
     * Cập nhật ảnh đại diện của user
     */
    async uploadAvatar(userId: string, file: Express.Multer.File) {
        const { existingUser, objectUserId } = await this.checkUser(userId);
        let uploadedAvatar: Media | null = null;
        let isUpdatedUser = false;
        const session = await this.connection.startSession();
        try {
            uploadedAvatar = await this.mediaService.uploadImageToCloudinary(
                objectUserId,
                OwnerTypeEnum.USER,
                objectUserId,
                file,
                MEDIA_CONSTANTS.USER_AVATAR_FOLDER,
            );
            if (!uploadedAvatar) {
                throw new BadRequestException(
                    MEDIA_MESSAGES.FILE_UPLOAD_FAILED,
                );
            }
            const avatarOld = existingUser.avatar
                ? await this.mediaService.findById(
                      existingUser.avatar.toString(),
                  )
                : null;
            const user = await session.withTransaction(async () => {
                const createdMedia = await this.mediaService.createMedia(
                    uploadedAvatar as Media,
                    session,
                );
                const updatedUser = await this.userModel
                    .findByIdAndUpdate(
                        objectUserId,
                        {
                            $set: {
                                avatar: createdMedia._id,
                            },
                        },
                        { new: true, session },
                    )
                    .select('-password -__v')
                    .populate('avatar', '-__v')
                    .lean();
                if (!updatedUser) {
                    throw new BadRequestException(
                        USER_MESSAGES.AVATAR_UPLOAD_FAILED,
                    );
                }
                if (avatarOld) {
                    const resultDeleteMedia =
                        await this.mediaService.deleteMedia(
                            avatarOld._id.toString(),
                            session,
                        );
                    if (!resultDeleteMedia) {
                        throw new BadRequestException(
                            MEDIA_MESSAGES.MEDIA_DELETE_FAILED,
                        );
                    }
                }
                return updatedUser as UserResponse;
            });
            if (!user) {
                throw new BadRequestException(
                    USER_MESSAGES.AVATAR_UPLOAD_FAILED,
                );
            }
            isUpdatedUser = true;
            if (avatarOld?.publicId) {
                await this.mediaService
                    .deleteImageFromCloudinaryWithCleanup(avatarOld.publicId, {
                        entityId: user._id.toString(),
                        entityType: CleanupJobEntityEnum.USER,
                        resourceType: CleanupJobResourceEnum.USER_AVATAR,
                    })
                    .catch((error) => {
                        console.error('Failed to delete old avatar:', error);
                    });
            }
            return this.serializeUserResponse(user);
        } catch (error) {
            if (uploadedAvatar && uploadedAvatar.publicId && !isUpdatedUser) {
                await this.mediaService
                    .deleteImageFromCloudinaryWithCleanup(
                        uploadedAvatar.publicId,
                        {
                            entityId: objectUserId.toString(),
                            entityType: CleanupJobEntityEnum.USER,
                            resourceType: CleanupJobResourceEnum.USER_AVATAR,
                        },
                    )
                    .catch((cleanupError) => {
                        console.error(
                            'Failed to cleanup uploaded avatar:',
                            cleanupError,
                        );
                    });
            }
            throw error;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Xóa ảnh đại diện của user
     */
    async deleteAvatar(userId: string) {
        const { existingUser, objectUserId } = await this.checkUser(userId);
        if (!existingUser.avatar) {
            throw new BadRequestException(USER_MESSAGES.AVATAR_NOT_EXIST);
        }
        const avatarOld = await this.mediaService.findById(
            existingUser.avatar.toString(),
        );

        const session = await this.connection.startSession();
        try {
            const user = await session.withTransaction(async () => {
                const updatedUser = await this.userModel
                    .findByIdAndUpdate(
                        objectUserId,
                        {
                            $unset: {
                                avatar: '',
                            },
                        },
                        { new: true, session },
                    )
                    .select('-password -__v')
                    .populate('avatar', '-__v')
                    .lean();
                if (!updatedUser) {
                    throw new BadRequestException(
                        USER_MESSAGES.AVATAR_DELETE_FAILED,
                    );
                }
                if (avatarOld) {
                    const resultDeleteMedia =
                        await this.mediaService.deleteMedia(
                            avatarOld._id.toString(),
                            session,
                        );
                    if (!resultDeleteMedia) {
                        throw new BadRequestException(
                            MEDIA_MESSAGES.MEDIA_DELETE_FAILED,
                        );
                    }
                }
                return updatedUser as UserResponse;
            });
            if (!user) {
                throw new BadRequestException(
                    USER_MESSAGES.AVATAR_DELETE_FAILED,
                );
            }
            if (avatarOld?.publicId) {
                await this.mediaService
                    .deleteImageFromCloudinaryWithCleanup(avatarOld.publicId, {
                        entityId: objectUserId.toString(),
                        entityType: CleanupJobEntityEnum.USER,
                        resourceType: CleanupJobResourceEnum.USER_AVATAR,
                    })
                    .catch((error) => {
                        console.error('Failed to delete old avatar:', error);
                    });
            }
            return this.serializeUserResponse(user);
        } finally {
            await session.endSession();
        }
    }

    /**
     * Xác nhận mật khẩu
     */
    async confirmPassword(userId: string, password: string) {
        const { existingUser } = await this.checkUser(userId);

        const isPasswordValid = await bcrypt.compare(
            password,
            existingUser.password,
        );
        if (!isPasswordValid) {
            throw new BadRequestException(USER_MESSAGES.PASSWORD_NOT_MATCH);
        }
        return true;
    }

    /**
     * Cập nhật email
     */
    async updateEmail(userId: string, email: string, code: string) {
        const { objectUserId } = await this.checkUser(userId);

        const session = await this.connection.startSession();
        try {
            const hashCode = hashCodeVerifyEmail(
                code,
                this.configService.get<string>('CODE_VERIFY_PEPPER')!,
            );
            const redisKey = this.redisUpdateEmailKey(userId, email);

            const codeRedis = await this.redisService.get(redisKey);
            if (codeRedis !== hashCode) {
                throw new BadRequestException(USER_MESSAGES.INVALID_CODE);
            }

            const user = await session.withTransaction(async () => {
                const isEmailExisted = await this.userModel
                    .findOne({
                        email,
                        _id: { $ne: objectUserId },
                    })
                    .session(session)
                    .select('_id')
                    .lean();
                if (isEmailExisted) {
                    throw new BadRequestException(USER_MESSAGES.EMAIL_EXISTED);
                }
                const updatedUser = await this.userModel
                    .findOneAndUpdate(
                        {
                            _id: objectUserId,
                            isDisabled: false,
                        },
                        {
                            $set: {
                                email,
                            },
                        },
                        { new: true, session },
                    )
                    .select('-password -__v')
                    .populate('avatar', '-__v')
                    .lean();
                if (!updatedUser) {
                    throw new BadRequestException(
                        USER_MESSAGES.EMAIL_UPDATE_FAILED,
                    );
                }
                return updatedUser as UserResponse;
            });
            if (!user) {
                throw new BadRequestException(
                    USER_MESSAGES.EMAIL_UPDATE_FAILED,
                );
            }
            await this.redisService.del(redisKey).catch((error) => {
                console.error(
                    'Failed to delete redis update email key:',
                    error,
                );
            });
            return this.serializeUserResponse(user);
        } finally {
            await session.endSession();
        }
    }

    /**
     * Gửi mail xác nhận khi update email
     */
    async sendMailUpdateEmail(userId: string, email: string) {
        const objectUserId = toObjectId(userId, 'user id');
        const [user, isEmailExisted] = await Promise.all([
            this.userModel
                .findOne({
                    _id: objectUserId,
                    isDisabled: false,
                    isActive: true,
                })
                .select('_id email')
                .lean(),
            this.userModel
                .findOne({
                    email,
                    _id: { $ne: objectUserId },
                })
                .select('_id')
                .lean(),
        ]);
        if (!user) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }
        if (isEmailExisted) {
            throw new BadRequestException(USER_MESSAGES.EMAIL_EXISTED);
        }

        if (email === user.email) {
            throw new BadRequestException(USER_MESSAGES.EMAIL_NOT_CHANGED);
        }

        await this.checkMailCooldownRedis(
            this.redisUpdateEmailKey(user._id.toString(), email),
            this.configService.get<string>('MAIL_CODE_UPDATE_EMAIL_EXPIRE')!,
            GLOBAL_CONSTANTS.COOLDOWN_SECONDS,
        );

        const codeUpdateEmailId = uuidv4();
        await this.saveCodeRedis(
            user._id.toString(),
            codeUpdateEmailId,
            'UPDATE_EMAIL',
            email,
        );
        const expireTime = this.configService.get<string>(
            'MAIL_CODE_UPDATE_EMAIL_EXPIRE',
        )!;
        const expireTimeFormatted = formatExpireTime(expireTime);
        this.sendEmailViaResend(
            email,
            'Verify Your New Email!',
            this.configService.get<string>('MAIL_UPDATE_EMAIL_TEMPLATE') ||
                'verify-new-email',
            {
                email: email,
                activationCode: codeUpdateEmailId,
                expireTime: expireTimeFormatted,
            },
        ).catch((error) => {
            console.error(error);
        });
        return 'OK';
    }

    /**
     * Kiểm tra user tồn tại, đã kích hoạt và không bị khóa
     */
    async checkUser(userId: string) {
        const objectUserId = toObjectId(userId, 'user id');
        const existingUser = await this.userModel.findById(objectUserId);
        if (!existingUser) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }
        if (existingUser.isActive === false) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_ACTIVE);
        }
        if (existingUser.isDisabled) {
            throw new BadRequestException(USER_MESSAGES.USER_DISABLED);
        }
        return { existingUser, objectUserId };
    }
}
