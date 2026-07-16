/* eslint-disable @typescript-eslint/no-unsafe-member-access */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
    BadRequestException,
    forwardRef,
    Inject,
    Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';
import { toObjectId, validateObjectId } from '@/utils/utils';
import { RelationshipsService } from '../relationships/relationships.service';
import { USER_MESSAGES } from './constants/user.constant';
import { User } from './schemas/user.schema';
import { UserResponse, UserResponseWithPagination } from './types/user';
import { UserSerializerService } from './user-serializer.service';

@Injectable()
export class UserQueryService {
    constructor(
        @InjectModel(User.name) private userModel: Model<User>,
        @Inject(forwardRef(() => RelationshipsService))
        private readonly relationshipsService: RelationshipsService,
        private readonly userSerializerService: UserSerializerService,
    ) {}

    /**
     * Láº¥y danh sÃ¡ch user cÃ³ há»— trá»£ phÃ¢n trang vÃ  filter.
     */
    async findAll(
        query: any,
        current: number,
        pageSize: number,
        forAdmin = false,
    ) {
        if (!current) current = 1;
        if (!pageSize) pageSize = GLOBAL_CONSTANTS.LIMIT_USERS_DEFAULT;
        const filter: any = {};
        const andConditions: any[] = [];

        // Láº¥y keyword tá»« query
        const keyword = query.query || '';

        if (keyword) {
            andConditions.push({
                $or: [
                    { name: { $regex: keyword, $options: 'i' } },
                    { email: { $regex: keyword, $options: 'i' } },
                    { phone: { $regex: keyword, $options: 'i' } },
                ],
            });
        }

        const status = query.status;
        if (status) {
            if (status === 'active') {
                andConditions.push({ isActive: true, isDisabled: false });
            } else if (status === 'banned') {
                andConditions.push({ isDisabled: true });
            } else if (status === 'unverified') {
                andConditions.push({ isActive: false, isDisabled: false });
            } else if (status === 'suspended') {
                andConditions.push({ banUntil: { $gt: new Date() } });
            }
        }

        const role = query.role;
        if (role) {
            andConditions.push({ role });
        }

        if (andConditions.length > 0) {
            filter.$and = andConditions;
        }

        const totalItems = await this.userModel.countDocuments(filter);
        const totalPages = Math.ceil(totalItems / pageSize);
        const skip = (current - 1) * pageSize;

        let sortCondition: any = { createdAt: -1 };
        if (query.sort === 'name_asc') {
            sortCondition = { name: 1 };
        } else if (query.sort === 'name_desc') {
            sortCondition = { name: -1 };
        }

        const users: UserResponse[] = await this.userModel
            .find(filter)
            .skip(skip)
            .limit(pageSize)
            .select('-password -__v')
            .populate('avatar', '-__v')
            .sort(sortCondition)
            .lean();

        return {
            totalPages,
            totalItems,
            users: users.map((user) =>
                this.userSerializerService.serializeUserResponse(
                    user,
                    forAdmin,
                ),
            ),
        } as UserResponseWithPagination;
    }

    /**
     * Láº¥y thÃ´ng tin user an toÃ n (khÃ´ng chá»©a password), tráº£ vá» plain object (lean) Ä‘á»ƒ API response.
     */
    async findOneForApi(id: string, forAdmin = false) {
        validateObjectId(id, 'user id');
        const user = (await this.userModel
            .findById(id)
            .select('-password -__v')
            .populate('avatar', '-__v')
            .lean()) as UserResponse;

        return this.userSerializerService.serializeUserResponse(user, forAdmin);
    }

    /**
     * Láº¥y Mongoose Document cá»§a user theo ID (dÃ¹ng cho logic ná»™i bá»™ cáº§n gá»i .save()).
     */
    async findOne(id: string) {
        validateObjectId(id, 'user id');
        return await this.userModel.findById(id);
    }

    /**
     * TÃ¬m kiáº¿m user báº±ng email hoáº·c sá»‘ Ä‘iá»‡n thoáº¡i
     */
    async findOneByEmailOrPhone(
        userId: string,
        search: string,
        forAdmin = false,
    ) {
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
                ...(forAdmin
                    ? {}
                    : {
                          isDisabled: false,
                          isActive: true,
                          $or: [
                              { banUntil: { $exists: false } },
                              { banUntil: null },
                              { banUntil: { $lt: new Date() } },
                          ],
                      }),
            })
            .select('-password -__v')
            .populate('avatar', '-__v')
            .lean()) as UserResponse;

        if (!searchUser) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }

        if (!forAdmin) {
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
        }

        return this.userSerializerService.serializeUserResponse(
            searchUser,
            forAdmin,
        );
    }

    /**
     * TÃ¬m user báº±ng email hoáº·c sá»‘ Ä‘iá»‡n thoáº¡i (thÆ°á»ng dÃ¹ng trong xÃ¡c thá»±c Login).
     */
    async findByEmailOrPhoneForLogin(identifier: string) {
        const isEmail = identifier.includes('@');
        const filter = isEmail ? { email: identifier } : { phone: identifier };
        return await this.userModel.findOne(filter).populate('avatar', '-__v');
    }

    /**
     * TÃ¬m user theo email Ä‘á»ƒ dÃ¹ng trong luá»“ng Google login.
     */
    async findByEmailForLogin(email: string) {
        return await this.userModel.findOne({
            email: email.toLowerCase(),
        });
    }

    /**
     * Äáº¿m sá»‘ lÆ°á»£ng user ID thá»±c sá»± tá»“n táº¡i trong DB, dÃ¹ng khi táº¡o group chat kiá»ƒm tra máº£ng ID truyá»n vÃ o cÃ³ há»£p lá»‡ khÃ´ng.
     */
    async countUserIdsExist(objectUserIds: Types.ObjectId[]) {
        return await this.userModel.countDocuments({
            _id: { $in: objectUserIds },
            isDisabled: false,
        });
    }

    /**
     * Kiá»ƒm tra user
     */
    async checkUser(
        userId: string,
        checkDisable = true,
        checkActive = true,
        checkBan = true,
    ) {
        const objectUserId = toObjectId(userId, 'user id');
        const existingUser = await this.userModel.findById(objectUserId);
        if (!existingUser) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_FOUND);
        }
        if (checkActive === true && existingUser.isActive === false) {
            throw new BadRequestException(USER_MESSAGES.USER_NOT_ACTIVE);
        }
        if (checkDisable === true && existingUser.isDisabled) {
            throw new BadRequestException(USER_MESSAGES.USER_DISABLED);
        }
        if (
            checkBan === true &&
            existingUser.banUntil &&
            existingUser.banUntil > new Date()
        ) {
            throw new BadRequestException(USER_MESSAGES.USER_BANNED);
        }
        return { existingUser, objectUserId };
    }
}
