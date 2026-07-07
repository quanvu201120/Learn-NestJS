import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';

jest.mock('api-query-params', () => ({
    __esModule: true,
    default: jest.fn(),
}));

jest.mock('uuid', () => ({
    __esModule: true,
    v4: jest.fn(() => 'mock-uuid'),
}));

type HiddenHistoryItem = {
    userId: Types.ObjectId;
    isHidden?: boolean;
    hiddenAt?: Date;
};

type MockConversationDocument = {
    _id: Types.ObjectId;
    isGroup: boolean;
    name?: string;
    users: Types.ObjectId[];
    adminGroupId?: Types.ObjectId;
    lastMessageId?: Types.ObjectId;
    hiddenHistory?: HiddenHistoryItem[];
    save: jest.Mock;
};

type MockConversationModel = jest.Mock & {
    find: jest.Mock;
    findOne: jest.Mock;
    findById: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    findOneAndUpdate: jest.Mock;
    countDocuments: jest.Mock;
};

describe('ConversationsService', () => {
    let service: ConversationsService;
    let conversationModel: MockConversationModel;
    let userService: {
        countUserIdsExist: jest.Mock;
    };

    const currentUserId = new Types.ObjectId().toString();
    const otherUserId = new Types.ObjectId().toString();
    const thirdUserId = new Types.ObjectId().toString();
    const fourthUserId = new Types.ObjectId().toString();

    const createConversationDocument = (
        overrides: Partial<MockConversationDocument> = {},
    ): MockConversationDocument => ({
        _id: new Types.ObjectId(),
        isGroup: false,
        users: [],
        save: jest.fn(),
        ...overrides,
    });

    const createFindQuery = <T>(value: T) => {
        const query = {
            populate: jest.fn().mockReturnThis(),
            sort: jest.fn().mockResolvedValue(value),
        };

        return query;
    };

    const createFindOneQuery = <T>(value: T) => {
        const query = {
            populate: jest.fn(),
        };
        query.populate.mockReturnValueOnce(query).mockResolvedValueOnce(value);

        return query;
    };

    beforeEach(() => {
        conversationModel = jest.fn().mockImplementation((payload) => ({
            _id: new Types.ObjectId(),
            ...payload,
            save: jest.fn().mockResolvedValue({
                _id: new Types.ObjectId(),
                ...payload,
            }),
        })) as unknown as MockConversationModel;

        conversationModel.find = jest.fn();
        conversationModel.findOne = jest.fn();
        conversationModel.findById = jest.fn();
        conversationModel.findByIdAndUpdate = jest.fn();
        conversationModel.findOneAndUpdate = jest.fn();
        conversationModel.countDocuments = jest.fn();

        userService = {
            countUserIdsExist: jest.fn(),
        };

        service = new ConversationsService(
            conversationModel as never,
            {} as never,
            userService as never,
        );
    });

    describe('createConversation', () => {
        it('Case: tạo chat 1-1 mới thành công và ẩn phía người còn lại khi chưa có tin nhắn', async () => {
            const dto: CreateConversationDto = {
                users: [otherUserId],
                isGroup: false,
            };
            userService.countUserIdsExist.mockResolvedValue(2);
            conversationModel.findOne.mockResolvedValue(null);

            const result = await service.createConversation(dto, currentUserId);

            expect(conversationModel).toHaveBeenCalledWith({
                name: undefined,
                isGroup: false,
                users: expect.arrayContaining([
                    expect.any(Types.ObjectId),
                    expect.any(Types.ObjectId),
                ]),
                adminGroupId: undefined,
                hiddenHistory: [
                    {
                        userId: expect.any(Types.ObjectId),
                        isHidden: true,
                        hiddenAt: expect.any(Date),
                    },
                ],
            });
            expect(result).toMatchObject({
                isGroup: false,
            });
        });

        it('Case: tạo chat 1-1 thất bại khi chỉ có đúng 1 user sau khi loại trùng', async () => {
            const dto: CreateConversationDto = {
                users: [],
                isGroup: false,
            };

            await expect(
                service.createConversation(dto, currentUserId),
            ).rejects.toThrow(
                new BadRequestException(
                    'Direct conversation must have exactly 2 users',
                ),
            );
        });

        it('Case: tạo group thất bại khi thiếu tên nhóm', async () => {
            const dto: CreateConversationDto = {
                users: [otherUserId, thirdUserId],
                isGroup: true,
                name: '',
            };

            await expect(
                service.createConversation(dto, currentUserId),
            ).rejects.toThrow(
                new BadRequestException('Group name is required'),
            );
        });

        it('Case: tạo group thất bại khi số lượng thành viên nhỏ hơn 3 người', async () => {
            const dto: CreateConversationDto = {
                users: [otherUserId],
                isGroup: true,
                name: 'Nhom hoc tap',
            };

            await expect(
                service.createConversation(dto, currentUserId),
            ).rejects.toThrow(
                new BadRequestException(
                    'Group conversation must have at least 3 users including creator',
                ),
            );
        });

        it('Case: tạo conversation thất bại khi có user không tồn tại', async () => {
            const dto: CreateConversationDto = {
                users: [otherUserId],
                isGroup: false,
            };
            userService.countUserIdsExist.mockResolvedValue(1);

            await expect(
                service.createConversation(dto, currentUserId),
            ).rejects.toThrow(
                new BadRequestException('One or more users do not exist'),
            );
        });

        it('Case: tạo lại chat 1-1 cũ thì trả về conversation cũ nếu current user chưa xóa', async () => {
            const dto: CreateConversationDto = {
                users: [otherUserId],
                isGroup: false,
            };
            const existingConversation = createConversationDocument({
                users: [
                    new Types.ObjectId(currentUserId),
                    new Types.ObjectId(otherUserId),
                ],
                hiddenHistory: [
                    {
                        userId: new Types.ObjectId(otherUserId),
                        isHidden: true,
                    },
                ],
            });

            userService.countUserIdsExist.mockResolvedValue(2);
            conversationModel.findOne.mockResolvedValue(existingConversation);

            const result = await service.createConversation(dto, currentUserId);

            expect(conversationModel.findByIdAndUpdate).not.toHaveBeenCalled();
            expect(result).toBe(existingConversation);
        });

        it('Case: tạo lại chat 1-1 cũ thì restore đúng current user nếu user này đã xóa trước đó', async () => {
            const dto: CreateConversationDto = {
                users: [otherUserId],
                isGroup: false,
            };
            const existingConversation = createConversationDocument({
                users: [
                    new Types.ObjectId(currentUserId),
                    new Types.ObjectId(otherUserId),
                ],
                hiddenHistory: [
                    {
                        userId: new Types.ObjectId(currentUserId),
                        isHidden: true,
                    },
                    {
                        userId: new Types.ObjectId(otherUserId),
                        isHidden: true,
                    },
                ],
            });
            const restoredConversation = createConversationDocument({
                ...existingConversation,
                hiddenHistory: [
                    {
                        userId: new Types.ObjectId(currentUserId),
                        isHidden: false,
                    },
                    {
                        userId: new Types.ObjectId(otherUserId),
                        isHidden: true,
                    },
                ],
            });

            userService.countUserIdsExist.mockResolvedValue(2);
            conversationModel.findOne.mockResolvedValue(existingConversation);
            conversationModel.findByIdAndUpdate.mockResolvedValue(
                restoredConversation,
            );

            const result = await service.createConversation(dto, currentUserId);

            expect(conversationModel.findByIdAndUpdate).toHaveBeenCalledWith(
                existingConversation._id,
                {
                    $set: {
                        'hiddenHistory.$[item].isHidden': false,
                    },
                },
                {
                    new: true,
                    arrayFilters: [
                        {
                            'item.userId': expect.any(Types.ObjectId),
                        },
                    ],
                },
            );
            expect(result).toBe(restoredConversation);
        });

        it('Case: tạo group mới thì phải gán adminGroupId là current user', async () => {
            const dto: CreateConversationDto = {
                users: [otherUserId, thirdUserId],
                isGroup: true,
                name: 'Nhom bai tap',
            };
            userService.countUserIdsExist.mockResolvedValue(3);

            const result = await service.createConversation(dto, currentUserId);

            expect(conversationModel).toHaveBeenCalledWith({
                name: 'Nhom bai tap',
                isGroup: true,
                users: expect.arrayContaining([
                    expect.any(Types.ObjectId),
                    expect.any(Types.ObjectId),
                    expect.any(Types.ObjectId),
                ]),
                adminGroupId: expect.any(Types.ObjectId),
                hiddenHistory: undefined,
            });
            expect(result).toMatchObject({
                isGroup: true,
                name: 'Nhom bai tap',
            });
        });
    });

    describe('findAllByUser', () => {
        it('Case: lấy danh sách conversation theo user và loại bỏ các conversation đã bị user này xóa', async () => {
            const conversations = [createConversationDocument()];
            const query = createFindQuery(conversations);
            conversationModel.find.mockReturnValue(query);

            const result = await service.findAllByUser(currentUserId);

            expect(conversationModel.find).toHaveBeenCalledWith({
                users: expect.any(Types.ObjectId),
                hiddenHistory: {
                    $not: {
                        $elemMatch: {
                            userId: expect.any(Types.ObjectId),
                            isHidden: true,
                        },
                    },
                },
            });
            expect(query.populate).toHaveBeenNthCalledWith(
                1,
                'users',
                '-password',
            );
            expect(query.populate).toHaveBeenNthCalledWith(2, 'lastMessageId');
            expect(query.sort).toHaveBeenCalledWith({ updatedAt: -1 });
            expect(result).toBe(conversations);
        });
    });

    describe('findOne', () => {
        it('Case: lấy chi tiết một conversation khi user là thành viên và chưa bị ẩn', async () => {
            const conversation = createConversationDocument({
                users: [new Types.ObjectId(currentUserId)],
            });
            const query = createFindOneQuery(conversation);
            conversationModel.findOne.mockReturnValue(query);

            const result = await service.findOne(
                conversation._id.toString(),
                currentUserId,
            );

            expect(conversationModel.findOne).toHaveBeenCalledWith({
                _id: conversation._id,
                users: expect.any(Types.ObjectId),
                hiddenHistory: {
                    $not: {
                        $elemMatch: {
                            userId: expect.any(Types.ObjectId),
                            isHidden: true,
                        },
                    },
                },
            });
            expect(result).toBe(conversation);
        });
    });

    describe('updateLastMessageAndRestoreConversation', () => {
        it('Case: có tin nhắn mới thì cập nhật lastMessageId và mở lại conversation cho người đang bị ẩn', async () => {
            const conversationId = new Types.ObjectId();
            const messageId = new Types.ObjectId();
            const updatedConversation = createConversationDocument({
                _id: conversationId,
                lastMessageId: messageId,
            });
            conversationModel.findByIdAndUpdate.mockResolvedValue(
                updatedConversation,
            );

            const result =
                await service.updateLastMessageAndRestoreConversation(
                    conversationId.toString(),
                    messageId.toString(),
                    currentUserId,
                );

            expect(conversationModel.findByIdAndUpdate).toHaveBeenCalledWith(
                conversationId,
                {
                    $set: {
                        lastMessageId: messageId,
                        'hiddenHistory.$[item].isHidden': false,
                        [`readReceipts.${currentUserId}`]: messageId,
                    },
                },
                {
                    new: true,
                    arrayFilters: [{ 'item.isHidden': true }],
                },
            );
            expect(result).toBe(updatedConversation);
        });
    });

    describe('updateNameConversation', () => {
        it('Case: admin đổi tên group thành công', async () => {
            const conversation = createConversationDocument({
                isGroup: true,
                adminGroupId: new Types.ObjectId(currentUserId),
                users: [
                    new Types.ObjectId(currentUserId),
                    new Types.ObjectId(otherUserId),
                ],
            });
            const updatedConversation = createConversationDocument({
                ...conversation,
                name: 'Ten moi',
            });
            conversationModel.findById.mockResolvedValue(conversation);
            conversationModel.findByIdAndUpdate.mockResolvedValue(
                updatedConversation,
            );

            const result = await service.updateNameConversation(
                conversation._id.toString(),
                currentUserId,
                'Ten moi',
            );

            expect(conversationModel.findByIdAndUpdate).toHaveBeenCalledWith(
                conversation._id,
                { $set: { name: 'Ten moi' } },
                { new: true },
            );
            expect(result).toBe(updatedConversation);
        });

        it('Case: đổi tên thất bại khi conversation là chat 1-1', async () => {
            const conversation = createConversationDocument({
                isGroup: false,
            });
            conversationModel.findById.mockResolvedValue(conversation);

            await expect(
                service.updateNameConversation(
                    conversation._id.toString(),
                    currentUserId,
                    'Ten moi',
                ),
            ).rejects.toThrow(
                new BadRequestException(
                    'Cannot perform this action on direct conversation',
                ),
            );
        });

        it('Case: đổi tên thất bại khi current user không phải admin group', async () => {
            const conversation = createConversationDocument({
                isGroup: true,
                adminGroupId: new Types.ObjectId(otherUserId),
            });
            conversationModel.findById.mockResolvedValue(conversation);

            await expect(
                service.updateNameConversation(
                    conversation._id.toString(),
                    currentUserId,
                    'Ten moi',
                ),
            ).rejects.toThrow(
                new BadRequestException('You are not admin of this group'),
            );
        });

        it('Case: đổi tên thất bại khi tên mới rỗng hoặc chỉ có khoảng trắng', async () => {
            const conversation = createConversationDocument({
                isGroup: true,
                adminGroupId: new Types.ObjectId(currentUserId),
            });
            conversationModel.findById.mockResolvedValue(conversation);

            await expect(
                service.updateNameConversation(
                    conversation._id.toString(),
                    currentUserId,
                    '   ',
                ),
            ).rejects.toThrow(new BadRequestException('Name is required'));
        });
    });

    describe('addMembers', () => {
        it('Case: admin thêm thành viên mới vào group thành công', async () => {
            const conversation = createConversationDocument({
                isGroup: true,
                adminGroupId: new Types.ObjectId(currentUserId),
                users: [
                    new Types.ObjectId(currentUserId),
                    new Types.ObjectId(otherUserId),
                ],
            });
            const updatedConversation = createConversationDocument({
                ...conversation,
                users: [
                    ...conversation.users,
                    new Types.ObjectId(thirdUserId),
                    new Types.ObjectId(fourthUserId),
                ],
            });
            conversationModel.findById.mockResolvedValue(conversation);
            userService.countUserIdsExist.mockResolvedValue(2);
            conversationModel.findByIdAndUpdate.mockResolvedValue(
                updatedConversation,
            );

            const result = await service.addMembers(
                conversation._id.toString(),
                currentUserId,
                [thirdUserId, fourthUserId],
            );

            expect(conversationModel.findByIdAndUpdate).toHaveBeenCalledWith(
                conversation._id,
                {
                    $addToSet: {
                        users: {
                            $each: [
                                expect.any(Types.ObjectId),
                                expect.any(Types.ObjectId),
                            ],
                        },
                    },
                },
                { new: true },
            );
            expect(result).toBe(updatedConversation);
        });

        it('Case: thêm thành viên thất bại khi current user không phải admin group', async () => {
            const conversation = createConversationDocument({
                isGroup: true,
                adminGroupId: new Types.ObjectId(otherUserId),
            });
            conversationModel.findById.mockResolvedValue(conversation);

            await expect(
                service.addMembers(conversation._id.toString(), currentUserId, [
                    thirdUserId,
                ]),
            ).rejects.toThrow(
                new BadRequestException('You are not admin of this group'),
            );
        });

        it('Case: thêm thành viên thất bại khi conversation là chat 1-1', async () => {
            const conversation = createConversationDocument({
                isGroup: false,
            });
            conversationModel.findById.mockResolvedValue(conversation);

            await expect(
                service.addMembers(conversation._id.toString(), currentUserId, [
                    thirdUserId,
                ]),
            ).rejects.toThrow(
                new BadRequestException(
                    'Cannot perform this action on direct conversation',
                ),
            );
        });

        it('Case: thêm thành viên thất bại khi có ít nhất một user không tồn tại', async () => {
            const conversation = createConversationDocument({
                isGroup: true,
                adminGroupId: new Types.ObjectId(currentUserId),
            });
            conversationModel.findById.mockResolvedValue(conversation);
            userService.countUserIdsExist.mockResolvedValue(1);

            await expect(
                service.addMembers(conversation._id.toString(), currentUserId, [
                    thirdUserId,
                    fourthUserId,
                ]),
            ).rejects.toThrow(
                new BadRequestException('One or more users do not exist'),
            );
        });
    });

    describe('removeMember', () => {
        it('Case: admin xóa thành viên khỏi group thành công', async () => {
            const conversation = createConversationDocument({
                isGroup: true,
                adminGroupId: new Types.ObjectId(currentUserId),
                users: [
                    new Types.ObjectId(currentUserId),
                    new Types.ObjectId(otherUserId),
                ],
            });
            const updatedConversation = createConversationDocument({
                ...conversation,
                users: [new Types.ObjectId(currentUserId)],
            });
            conversationModel.findById.mockResolvedValue(conversation);
            conversationModel.findByIdAndUpdate.mockResolvedValue(
                updatedConversation,
            );

            const result = await service.removeMember(
                conversation._id.toString(),
                currentUserId,
                otherUserId,
            );

            expect(conversationModel.findByIdAndUpdate).toHaveBeenCalledWith(
                conversation._id,
                {
                    $pull: {
                        users: expect.any(Types.ObjectId),
                        hiddenHistory: { userId: expect.any(Types.ObjectId) },
                    },
                    $unset: {
                        [`readReceipts.${otherUserId}`]: 1,
                    },
                },
                { new: true },
            );
            expect(result).toBe(updatedConversation);
        });

        it('Case: xóa thành viên thất bại khi current user không phải admin group', async () => {
            const conversation = createConversationDocument({
                isGroup: true,
                adminGroupId: new Types.ObjectId(otherUserId),
                users: [
                    new Types.ObjectId(currentUserId),
                    new Types.ObjectId(otherUserId),
                ],
            });
            conversationModel.findById.mockResolvedValue(conversation);

            await expect(
                service.removeMember(
                    conversation._id.toString(),
                    currentUserId,
                    otherUserId,
                ),
            ).rejects.toThrow(
                new BadRequestException('You are not admin of this group'),
            );
        });

        it('Case: xóa thành viên thất bại khi admin tự xóa chính mình', async () => {
            const conversation = createConversationDocument({
                isGroup: true,
                adminGroupId: new Types.ObjectId(currentUserId),
                users: [new Types.ObjectId(currentUserId)],
            });
            conversationModel.findById.mockResolvedValue(conversation);

            await expect(
                service.removeMember(
                    conversation._id.toString(),
                    currentUserId,
                    currentUserId,
                ),
            ).rejects.toThrow(
                new BadRequestException(
                    'Cannot remove yourself from conversation',
                ),
            );
        });

        it('Case: xóa thành viên thất bại khi member không nằm trong group', async () => {
            const conversation = createConversationDocument({
                isGroup: true,
                adminGroupId: new Types.ObjectId(currentUserId),
                users: [new Types.ObjectId(currentUserId)],
            });
            conversationModel.findById.mockResolvedValue(conversation);

            await expect(
                service.removeMember(
                    conversation._id.toString(),
                    currentUserId,
                    otherUserId,
                ),
            ).rejects.toThrow(
                new BadRequestException('User is not in conversation'),
            );
        });

        it('Case: xóa thành viên thất bại khi conversation là chat 1-1', async () => {
            const conversation = createConversationDocument({
                isGroup: false,
                users: [
                    new Types.ObjectId(currentUserId),
                    new Types.ObjectId(otherUserId),
                ],
            });
            conversationModel.findById.mockResolvedValue(conversation);

            await expect(
                service.removeMember(
                    conversation._id.toString(),
                    currentUserId,
                    otherUserId,
                ),
            ).rejects.toThrow(
                new BadRequestException(
                    'Cannot perform this action on direct conversation',
                ),
            );
        });
    });

    describe('hiddenHistory', () => {
        it('Case: xóa conversation lần đầu khi chưa có record thì tạo hiddenHistory mới với isHidden = true', async () => {
            const conversation = createConversationDocument({
                users: [new Types.ObjectId(currentUserId)],
                hiddenHistory: [],
            });
            const updatedConversation = createConversationDocument({
                ...conversation,
                hiddenHistory: [
                    {
                        userId: new Types.ObjectId(currentUserId),
                        isHidden: true,
                    },
                ],
            });
            conversationModel.findById.mockResolvedValue(conversation);
            conversationModel.findOneAndUpdate.mockResolvedValue(
                updatedConversation,
            );

            const result = await service.hiddenHistory(
                conversation._id.toString(),
                currentUserId,
            );

            expect(conversationModel.findOneAndUpdate).toHaveBeenCalledWith(
                {
                    _id: conversation._id,
                    'hiddenHistory.userId': { $ne: expect.any(Types.ObjectId) },
                },
                {
                    $push: {
                        hiddenHistory: {
                            userId: expect.any(Types.ObjectId),
                            isHidden: true,
                            hiddenAt: expect.any(Date),
                        },
                    },
                },
                { new: true },
            );
            expect(result).toBe(updatedConversation);
        });

        it('Case: xóa conversation khi đã có record isHidden = false thì cập nhật lại thành true', async () => {
            const conversation = createConversationDocument({
                users: [new Types.ObjectId(currentUserId)],
                hiddenHistory: [
                    {
                        userId: new Types.ObjectId(currentUserId),
                        isHidden: false,
                    },
                ],
            });
            const updatedConversation = createConversationDocument({
                ...conversation,
                hiddenHistory: [
                    {
                        userId: new Types.ObjectId(currentUserId),
                        isHidden: true,
                    },
                ],
            });
            conversationModel.findById.mockResolvedValue(conversation);
            conversationModel.findOneAndUpdate.mockResolvedValue(
                updatedConversation,
            );

            const result = await service.hiddenHistory(
                conversation._id.toString(),
                currentUserId,
            );

            expect(conversationModel.findOneAndUpdate).toHaveBeenCalledWith(
                {
                    _id: conversation._id,
                    hiddenHistory: {
                        $elemMatch: {
                            userId: expect.any(Types.ObjectId),
                            isHidden: false,
                        },
                    },
                },
                {
                    $set: {
                        'hiddenHistory.$.isHidden': true,
                        'hiddenHistory.$.hiddenAt': expect.any(Date),
                    },
                },
                { new: true },
            );
            expect(result).toBe(updatedConversation);
        });

        it('Case: xóa conversation lần 2 thất bại khi user đã ở trạng thái isHidden = true', async () => {
            const conversation = createConversationDocument({
                users: [new Types.ObjectId(currentUserId)],
                hiddenHistory: [
                    {
                        userId: new Types.ObjectId(currentUserId),
                        isHidden: true,
                    },
                ],
            });
            conversationModel.findById.mockResolvedValue(conversation);

            await expect(
                service.hiddenHistory(
                    conversation._id.toString(),
                    currentUserId,
                ),
            ).rejects.toThrow(
                new BadRequestException(
                    'Conversation already hidden for this user',
                ),
            );
        });
    });
});
