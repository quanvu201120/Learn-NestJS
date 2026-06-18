/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-non-null-asserted-optional-chain */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { USER_MESSAGES } from './constants/user.constant';
import { BadRequestException, Injectable } from '@nestjs/common';
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
import { UpdateUserDto } from './dto/update-user.dto';
import { ConfigService } from '@nestjs/config';
import ms, { StringValue } from 'ms';
import { v4 as uuidv4 } from 'uuid';
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
import { serializeMedia } from '../media/utils/media.serializer';
import { SessionService } from '../session/session.service';
import {
    CleanupJobEntityEnum,
    CleanupJobResourceEnum,
} from '../cleanup-jobs/types/cleanup-job';

@Injectable()
export class UsersService {
    constructor(
        @InjectModel(User.name) private userModel: Model<User>,
        @InjectConnection() private readonly connection: Connection,
        private configService: ConfigService,
        private readonly redisService: RedisService,
        private readonly mediaService: MediaService,
        private readonly sessionService: SessionService,
    ) {}

    /**
     * Chuẩn hóa dữ liệu avatar lồng bên trong trước khi trả object user về cho client.
     */
    private serializeUserResponse(user: UserResponse | null) {
        if (!user) {
            return user;
        }

        return {
            ...user,
            avatar: user.avatar ? serializeMedia(user.avatar) : user.avatar,
        } as UserResponse;
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
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
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
     * Tìm user bằng email (thường dùng trong xác thực Login).
     */
    async findByEmail(email: string) {
        return await this.userModel.findOne({ email });
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
     * Cập nhật thông tin user. Chỉ user chính chủ hoặc Admin mới được phép update.
     */
    async update(
        updateUserDto: UpdateUserDto,
        currentUser: string,
        role: string,
    ) {
        if (role !== 'ADMIN' && updateUserDto._id !== currentUser) {
            throw new BadRequestException(USER_MESSAGES.NOT_AUTHORIZED_UPDATE);
        }
        if (updateUserDto.email) {
            const isEmailExisted = await this.userModel.exists({
                email: updateUserDto.email,
                _id: { $ne: updateUserDto._id },
            });

            if (isEmailExisted) {
                throw new BadRequestException(USER_MESSAGES.EMAIL_EXISTED);
            }
        }

        const { _id, ...updateData } = updateUserDto;
        const normalizedEntries = Object.entries(updateData).filter(
            ([, value]) => value !== undefined,
        );
        const $set = Object.fromEntries(
            normalizedEntries.filter(
                ([key, value]) =>
                    value !== null || key === 'email' || key === 'name',
            ),
        );
        const $unset = Object.fromEntries(
            normalizedEntries
                .filter(
                    ([key, value]) =>
                        value === null && key !== 'email' && key !== 'name',
                )
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

        const user = (await this.userModel
            .findOneAndUpdate({ _id }, updateQuery, { new: true })
            .select('-password -__v')
            .populate('avatar', '-__v')
            .lean()) as UserResponse;

        if (!user) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }

        return this.serializeUserResponse(user);
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
    ): Promise<UserDisableStateResponse> {
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

        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
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

        const codeActive = uuidv4();

        // Lưu Redis ĐỒNG BỘ trước (bao gồm check cooldown)
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
        validateObjectId(id, 'user id');
        const { passwordOld, passwordNew } = changePasswordAuthDto;
        const user = await this.userModel.findById(id);
        if (!user) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }
        const isPasswordMatched = await bcrypt.compare(
            passwordOld,
            user.password,
        );
        if (!isPasswordMatched) {
            throw new BadRequestException(USER_MESSAGES.INVALID_PASSWORD);
        }

        const passwordNewHash = await hashPassword(passwordNew);

        user.password = passwordNewHash;
        await user.save();
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
                GLOBAL_CONSTANTS.COOLDOWN_SECONDS,
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
        return await this.userModel.updateOne(
            { _id: userId },
            { $set: { lastOnlineAt: new Date() } },
        );
    }

    /**
     * Cập nhật ảnh đại diện của user
     */
    async uploadAvatar(userId: string, file: Express.Multer.File) {
        const objectUserId = toObjectId(userId, 'user id');
        const existingUser = await this.userModel
            .findById(objectUserId)
            .select('_id avatar')
            .lean();
        if (!existingUser) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }
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
        const objectUserId = toObjectId(userId, 'user id');
        const existingUser = await this.userModel
            .findById(objectUserId)
            .select('_id avatar')
            .lean();
        if (!existingUser) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }
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
}
