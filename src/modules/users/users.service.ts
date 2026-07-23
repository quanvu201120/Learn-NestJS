/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { USER_MESSAGES } from './constants/user.constant';
import {
    BadRequestException,
    ForbiddenException,
    forwardRef,
    Inject,
    Injectable,
    Logger,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { GetUsersDto } from './dto/get-users.dto';
import { User } from './schemas/user.schema';
import { Connection, Model, Types } from 'mongoose';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
    formatExpireTime,
    hashCodeVerifyEmail,
    logCatch,
    validateObjectId,
    toObjectId,
    safeCompare,
} from '@/utils/utils';
import { UpdateUserDto } from './dto/update-user.dto';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { Subject } from 'rxjs';
import bcrypt from 'bcrypt';
import {
    ChangePasswordAuthDto,
    CreatePasswordAuthDto,
} from '@/auth/dto/password-auth.dto';
import { RedisService } from '@/redis/redis.service';
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';
import { UserDisableStateResponse, UserResponse, UserRole } from './types/user';
import { MediaService } from '../media/media.service';
import {
    MEDIA_CONSTANTS,
    MEDIA_MESSAGES,
} from '../media/constants/media.constant';
import { Media } from '../media/schemas/media.schema';
import { OwnerTypeEnum } from '../media/types/media';
import { serializeAdminUser, serializeUser } from './utils/user.serializer';
import { SessionService } from '../session/session.service';
import {
    CleanupJobEntityEnum,
    CleanupJobResourceEnum,
} from '../cleanup-jobs/types/cleanup-job';
import { ReportsService } from '../reports/reports.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
    AuditLogActionEnum,
    AuditLogTargetEnum,
} from '../audit-log/types/audit-log.type';
import { UserQueryService } from './user-query.service';
import { UserCodeService } from './user-code.service';
import { UserMailService } from './user-mail.service';
import { UserPasswordService } from './user-password.service';
import { UserAuthProfileService } from './user-auth-profile.service';

@Injectable()
export class UsersService {
    private readonly logger = new Logger(UsersService.name);

    public readonly userDisabled$ = new Subject<{ userId: string }>();

    constructor(
        @InjectModel(User.name) private userModel: Model<User>,
        @InjectConnection() private readonly connection: Connection,
        private configService: ConfigService,
        private readonly redisService: RedisService,
        private readonly mediaService: MediaService,
        private readonly sessionService: SessionService,
        @Inject(forwardRef(() => ReportsService))
        private readonly reportsService: ReportsService,
        private readonly eventEmitter: EventEmitter2,
        private readonly userQueryService: UserQueryService,
        private readonly userCodeService: UserCodeService,
        private readonly userMailService: UserMailService,
        private readonly userPasswordService: UserPasswordService,
        private readonly userAuthProfileService: UserAuthProfileService,
    ) {}

    /**
     * Chuẩn hóa dữ liệu avatar lồng bên trong trước khi trả object user về cho client.
     */
    private serializeUserResponse(
        user: UserResponse | null,
        forAdmin = false,
        hidden = false,
    ) {
        if (!user) {
            return user;
        }

        return forAdmin
            ? (serializeAdminUser(user) as UserResponse)
            : (serializeUser(user, false, hidden) as UserResponse);
    }

    /**
     * Hàm helper: Kiểm tra quyền chéo (Admin không được sửa Admin/Super Admin)
     */
    private checkAdminPermission(targetRole: string, adminRole: string) {
        if (
            adminRole === UserRole.ADMIN &&
            (targetRole === UserRole.ADMIN ||
                targetRole === UserRole.SUPER_ADMIN)
        ) {
            throw new ForbiddenException(USER_MESSAGES.MISSING_PERMISSION);
        }
        if (
            adminRole === UserRole.SUPER_ADMIN &&
            targetRole === UserRole.SUPER_ADMIN
        ) {
            throw new ForbiddenException(USER_MESSAGES.MISSING_PERMISSION);
        }
    }

    /**
     * Tạo tài khoản mới, sinh mã OTP lưu vào Redis và gửi email kích hoạt.
     * Mặc định tài khoản tạo ra sẽ ở trạng thái isActive = false.
     */
    async create(createUserDto: CreateUserDto, creatorRole?: string) {
        return await this.userAuthProfileService.create(
            createUserDto,
            creatorRole,
        );
    }

    /**
     * Helper đăng ký nhanh chỉ với email và password.
     */
    async register(email: string, pass: string) {
        return await this.userAuthProfileService.register(email, pass);
    }

    /**
     * Lấy danh sách user có hỗ trợ phân trang và filter.
     */
    async findAll(
        query: GetUsersDto,
        current: number,
        pageSize: number,
        forAdmin = false,
    ) {
        return this.userQueryService.findAll(
            query,
            current,
            pageSize,
            forAdmin,
        );
    }

    /**
     * Lấy thông tin user an toàn (không chứa password), trả về plain object (lean) để API response.
     */
    async findOneForApi(id: string, forAdmin = false) {
        return this.userQueryService.findOneForApi(id, forAdmin);
    }

    /**
     * Lấy Mongoose Document của user theo ID (dùng cho logic nội bộ cần gọi .save()).
     */
    async findOne(id: string) {
        return await this.userQueryService.findOne(id);
    }

    /**
     * Tìm kiếm user bằng email hoặc số điện thoại
     */
    async findOneByEmailOrPhone(
        userId: string,
        search: string,
        forAdmin = false,
    ) {
        return this.userQueryService.findOneByEmailOrPhone(
            userId,
            search,
            forAdmin,
        );
    }

    /**
     * Tìm user bằng email hoặc số điện thoại (thường dùng trong xác thực Login).
     */
    async findByEmailOrPhoneForLogin(identifier: string) {
        return await this.userQueryService.findByEmailOrPhoneForLogin(
            identifier,
        );
    }

    /**
     * Tìm user theo email để dùng trong luồng Google login.
     */
    async findByEmailForLogin(email: string) {
        return await this.userQueryService.findByEmailForLogin(email);
    }

    /**
     * Tạo account local từ Google login khi email chưa tồn tại.
     */
    async createGoogleAccount(email: string, name?: string) {
        return await this.userAuthProfileService.createGoogleAccount(
            email,
            name,
        );
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
            throw new BadRequestException(USER_MESSAGES.USER_DISABLED);
        }

        if (!isDisabled && !user.isDisabled) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_DISABLED);
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
            .findByIdAndUpdate(currentUser, updateQuery, {
                returnDocument: 'after',
            })
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
        const user = await this.userModel.findById(userId);
        if (
            user &&
            (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN)
        ) {
            throw new BadRequestException(USER_MESSAGES.CANNOT_DISABLE_ADMIN);
        }
        return this.setDisabledState(userId, true);
    }

    /**
     * Kích hoạt lại tài khoản đã bị vô hiệu hóa bởi Admin.
     */
    async enableUserByAdmin(
        userId: string,
        currentUserId: string,
        currentUserRole: string,
        passwordRaw: string,
        reason: string | undefined,
        req: any,
    ): Promise<UserDisableStateResponse> {
        validateObjectId(currentUserId, 'current user id');

        const currentUser = await this.userModel
            .findById(currentUserId)
            .select('password role');

        if (!currentUser) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }
        if (currentUser.role !== currentUserRole) {
            throw new ForbiddenException(USER_MESSAGES.MISSING_PERMISSION);
        }
        const isPasswordValid = await bcrypt.compare(
            passwordRaw,
            currentUser.password,
        );
        if (!isPasswordValid) {
            throw new BadRequestException(USER_MESSAGES.PASSWORD_NOT_MATCH);
        }

        if (userId === currentUserId) {
            throw new ForbiddenException(USER_MESSAGES.CAN_NOT_CHANGE_ME);
        }
        const { existingUser } = await this.checkUser(
            userId,
            false,
            false,
            false,
        );
        if (existingUser.isDisabled === false) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_DISABLED);
        }
        this.checkAdminPermission(existingUser.role, currentUserRole);

        const result = await this.setDisabledState(userId, false);

        this.eventEmitter.emit('audit.log.create', {
            req,
            actorId: currentUserId,
            actorRole: currentUserRole,
            action: AuditLogActionEnum.UNLOCK_USER,
            targetId: userId,
            targetType: AuditLogTargetEnum.USER,
            metadata: { reason },
        });

        return result;
    }

    /**
     * Gửi email chứa mã OTP để kích hoạt tài khoản.
     */
    async sendEmailActive(email: string, code: string) {
        return await this.userAuthProfileService.sendEmailActive(email, code);
    }

    /**
     * Kích hoạt tài khoản bằng mã OTP do người dùng nhập vào.
     */
    async activateUser(email: string, code: string) {
        return await this.userAuthProfileService.activateUser(email, code);
    }

    /**
     * Gửi lại mã OTP kích hoạt tài khoản, có check chống spam (cooldown).
     */
    async reSendCodeActive(email: string) {
        return await this.userAuthProfileService.reSendCodeActive(email);
    }

    /**
     * Đổi mật khẩu (có kiểm tra mật khẩu cũ).
     */
    async updatePassword(
        id: string,
        changePasswordAuthDto: ChangePasswordAuthDto,
        currentSessionId: string,
    ) {
        return await this.userPasswordService.updatePassword(
            id,
            changePasswordAuthDto,
            currentSessionId,
        );
    }

    /**
     * Tạo mật khẩu lần đầu (cho tài khoản google).
     */
    async createPassword(
        id: string,
        createPasswordAuthDto: CreatePasswordAuthDto,
    ) {
        return await this.userPasswordService.createPassword(
            id,
            createPasswordAuthDto,
        );
    }

    /**
     * Gửi mail cấp mã OTP khôi phục mật khẩu.
     */
    async sendMailForgotPassword(email: string) {
        return await this.userPasswordService.sendMailForgotPassword(email);
    }

    /**
     * Đặt lại mật khẩu mới thông qua mã OTP từ mail.
     */
    async resetPassword(email: string, code: string, password: string) {
        return await this.userPasswordService.resetPassword(
            email,
            code,
            password,
        );
    }

    /**
     * Đếm số lượng user ID thực sự tồn tại trong DB, dùng khi tạo group chat kiểm tra mảng ID truyền vào có hợp lệ không.
     */
    async countUserIdsExist(objectUserIds: Types.ObjectId[]) {
        return await this.userQueryService.countUserIdsExist(objectUserIds);
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
            uploadedAvatar = await this.mediaService.uploadFileToCloudinary(
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
            let isMediaInReport = false;
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
                        { returnDocument: 'after', session },
                    )
                    .select('-password -email -phone -__v')
                    .populate('avatar', '-__v')
                    .lean();
                if (!updatedUser) {
                    throw new BadRequestException(
                        USER_MESSAGES.AVATAR_UPLOAD_FAILED,
                    );
                }

                if (avatarOld) {
                    isMediaInReport = await this.reportsService.isMediaInReport(
                        avatarOld._id.toString(),
                    );
                    if (!isMediaInReport) {
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
                }
                return updatedUser as UserResponse;
            });
            if (!user) {
                throw new BadRequestException(
                    USER_MESSAGES.AVATAR_UPLOAD_FAILED,
                );
            }
            isUpdatedUser = true;

            if (avatarOld?.publicId && !isMediaInReport) {
                await this.mediaService
                    .deleteFileFromCloudinaryWithCleanup(avatarOld.publicId, {
                        entityId: user._id.toString(),
                        entityType: CleanupJobEntityEnum.USER,
                        resourceType: CleanupJobResourceEnum.USER_AVATAR,
                    })
                    .catch((error) => {
                        logCatch(
                            this.logger,
                            'Failed to delete old avatar',
                            error,
                        );
                    });
            }
            return this.serializeUserResponse(user);
        } catch (error) {
            if (uploadedAvatar && uploadedAvatar.publicId && !isUpdatedUser) {
                await this.mediaService
                    .deleteFileFromCloudinaryWithCleanup(
                        uploadedAvatar.publicId,
                        {
                            entityId: objectUserId.toString(),
                            entityType: CleanupJobEntityEnum.USER,
                            resourceType: CleanupJobResourceEnum.USER_AVATAR,
                        },
                    )
                    .catch((cleanupError) => {
                        logCatch(
                            this.logger,
                            'Failed to cleanup uploaded avatar',
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
            let isMediaInReport = false;
            const user = await session.withTransaction(async () => {
                const updatedUser = await this.userModel
                    .findByIdAndUpdate(
                        objectUserId,
                        {
                            $unset: {
                                avatar: '',
                            },
                        },
                        { returnDocument: 'after', session },
                    )
                    .select('-password -email -phone -__v')
                    .populate('avatar', '-__v')
                    .lean();
                if (!updatedUser) {
                    throw new BadRequestException(
                        USER_MESSAGES.AVATAR_DELETE_FAILED,
                    );
                }

                if (avatarOld) {
                    isMediaInReport = await this.reportsService.isMediaInReport(
                        avatarOld._id.toString(),
                    );
                    if (!isMediaInReport) {
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
                }
                return updatedUser as UserResponse;
            });
            if (!user) {
                throw new BadRequestException(
                    USER_MESSAGES.AVATAR_DELETE_FAILED,
                );
            }

            if (avatarOld?.publicId && !isMediaInReport) {
                await this.mediaService
                    .deleteFileFromCloudinaryWithCleanup(avatarOld.publicId, {
                        entityId: objectUserId.toString(),
                        entityType: CleanupJobEntityEnum.USER,
                        resourceType: CleanupJobResourceEnum.USER_AVATAR,
                    })
                    .catch((error) => {
                        logCatch(
                            this.logger,
                            'Failed to delete old avatar',
                            error,
                        );
                    });
            }
            return this.serializeUserResponse(user);
        } finally {
            await session.endSession();
        }
    }

    /**
     * SUPER_ADMIN thay đổi Role của người dùng
     */
    async changeRoleBySuperAdmin(
        targetUserId: string,
        newRole: UserRole,
        superAdminId: string,
        passwordRaw: string,
        reason: string | undefined,
        req: any,
    ) {
        validateObjectId(targetUserId, 'target user id');
        validateObjectId(superAdminId, 'super admin id');

        const superAdmin = await this.userModel.findById(superAdminId);
        if (!superAdmin) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }
        if (superAdmin.role !== UserRole.SUPER_ADMIN) {
            throw new ForbiddenException(USER_MESSAGES.MISSING_PERMISSION);
        }

        const isPasswordValid = await bcrypt.compare(
            passwordRaw,
            superAdmin.password,
        );
        if (!isPasswordValid) {
            throw new BadRequestException(USER_MESSAGES.PASSWORD_NOT_MATCH);
        }

        const targetUser = await this.userModel.findById(targetUserId);
        if (!targetUser) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }

        if (targetUserId === superAdminId) {
            throw new ForbiddenException(USER_MESSAGES.CAN_NOT_CHANGE_ME);
        }

        this.checkAdminPermission(targetUser.role, superAdmin.role);

        if (targetUser.role === newRole) {
            throw new BadRequestException(USER_MESSAGES.ROLE_NOT_CHANGED);
        }
        const oldRole = targetUser.role;
        targetUser.role = newRole;
        targetUser.tokenVersion += 1;
        await targetUser.save();

        this.eventEmitter.emit('audit.log.create', {
            req,
            actorId: superAdminId,
            actorRole: superAdmin.role,
            action: AuditLogActionEnum.UPDATE_ROLE,
            targetId: targetUserId,
            targetType: AuditLogTargetEnum.USER,
            metadata: { oldRole, newRole, reason },
        });

        return this.serializeUserResponse(
            targetUser.toObject() as UserResponse,
            true,
        );
    }

    /**
     * Xác nhận mật khẩu
     */
    async confirmPassword(userId: string, password: string) {
        return await this.userPasswordService.confirmPassword(userId, password);
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
            const redisKey = this.userCodeService.redisUpdateEmailKey(
                userId,
                email,
            );

            const codeRedis = await this.redisService.get(redisKey);
            if (!safeCompare(codeRedis, hashCode)) {
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
                        { returnDocument: 'after', session },
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
                logCatch(
                    this.logger,
                    'Failed to delete redis update email key',
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

        await this.userCodeService.checkMailCooldownRedis(
            this.userCodeService.redisUpdateEmailKey(
                user._id.toString(),
                email,
            ),
            this.configService.get<string>('MAIL_CODE_UPDATE_EMAIL_EXPIRE')!,
            GLOBAL_CONSTANTS.COOLDOWN_SECONDS,
        );

        const codeUpdateEmailId = uuidv4();
        await this.userCodeService.saveCodeRedis(
            user._id.toString(),
            codeUpdateEmailId,
            'UPDATE_EMAIL',
            email,
        );
        const expireTime = this.configService.get<string>(
            'MAIL_CODE_UPDATE_EMAIL_EXPIRE',
        )!;
        const expireTimeFormatted = formatExpireTime(expireTime);
        this.userMailService
            .sendEmailViaResend(
                email,
                'Verify Your New Email!',
                this.configService.get<string>('MAIL_UPDATE_EMAIL_TEMPLATE') ||
                    'verify-new-email',
                {
                    email: email,
                    activationCode: codeUpdateEmailId,
                    expireTime: expireTimeFormatted,
                },
            )
            .catch((error) => {
                logCatch(
                    this.logger,
                    'Failed to send update-email verification',
                    error,
                );
            });
        return 'OK';
    }

    /**
     * Kiểm tra user
     */
    async checkUser(
        userId: string,
        checkDisable = true,
        checkActive = true,
        checkBan = true,
    ) {
        return await this.userQueryService.checkUser(
            userId,
            checkDisable,
            checkActive,
            checkBan,
        );
    }
}
