import { CALL_MESSAGES } from './constants/call.constant';
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Call, CallDocument } from './schemas/call.schema';
import { CallEndReasonEnum, CallStatusEnum, CallTypeEnum } from './types/call';
import { UsersService } from '../users/users.service';
import { ConversationsService } from '../conversations/conversations.service';
import { RelationshipsService } from '../relationships/relationships.service';
import { toObjectId } from '@/utils/utils';
import { Message, MessageDocument } from '../messages/schemas/message.schema';
import { MessageEnumType } from '../messages/types/message';

@Injectable()
export class CallService {
    constructor(
        @InjectModel(Call.name)
        private readonly callModel: Model<CallDocument>,
        @InjectModel(Message.name)
        private readonly messageModel: Model<MessageDocument>,
        @InjectConnection()
        private readonly connection: Connection,
        private readonly usersService: UsersService,
        private readonly conversationsService: ConversationsService,
        private readonly relationshipsService: RelationshipsService,
    ) {}

    /**
     * Lấy một cuộc gọi theo ID để kiểm tra hoặc cập nhật trạng thái.
     */
    async findById(callId: string) {
        return this.callModel.findById(toObjectId(callId, 'callId'));
    }

    /**
     * Tìm cuộc gọi active của một user, gồm cả `calling` và `accepted`.
     * Dùng để chặn start call mới khi user còn đang trong cuộc gọi khác.
     */
    async findActiveCallByUserId(userId: string) {
        const objectUserId = toObjectId(userId, 'userId');
        return this.callModel
            .findOne({
                status: {
                    $in: [CallStatusEnum.CALLING, CallStatusEnum.ACCEPTED],
                },
                $or: [{ callerId: objectUserId }, { calleeId: objectUserId }],
            })
            .lean();
    }

    /**
     * Tìm cuộc gọi `calling` còn hiệu lực của user để sync lại sau khi reconnect socket.
     */
    async findActiveCallingCallByUserId(userId: string, beforeDate: Date) {
        const objectUserId = toObjectId(userId, 'userId');
        return this.callModel
            .findOne({
                status: CallStatusEnum.CALLING,
                createdAt: { $gte: beforeDate },
                calleeId: objectUserId,
            })
            .sort({ createdAt: -1 })
            .lean();
    }

    /**
     * Lấy các cuộc gọi `calling` đã quá ngưỡng timeout để cron dọn dẹp.
     */
    async findStaleCallingCalls(beforeDate: Date) {
        return this.callModel
            .find({
                status: CallStatusEnum.CALLING,
                createdAt: { $lte: beforeDate },
            })
            .lean();
    }

    /**
     * Lấy các cuộc gọi `accepted` để cron kiểm tra heartbeat và phát hiện call chết.
     */
    async findAcceptedCalls() {
        return this.callModel
            .find({
                status: CallStatusEnum.ACCEPTED,
            })
            .lean();
    }

    /**
     * Tạo một bản ghi cuộc gọi mới sau khi đã kiểm tra người gọi, người nhận,
     * block relation và quyền tham gia conversation nếu có.
     */
    async createCall(params: {
        callerId: string;
        calleeId: string;
        conversationId: string;
        callType: CallTypeEnum;
    }) {
        const { callerId, calleeId, conversationId, callType } = params;

        if (callerId === calleeId) {
            throw new BadRequestException(CALL_MESSAGES.USER_NOT_ALLOWED);
        }
        const objectConversationId = toObjectId(
            conversationId,
            'conversation id',
        );
        const [
            { objectUserId: callerObjectId },
            { objectUserId: calleeObjectId },
        ] = await Promise.all([
            this.usersService.checkUser(callerId),
            this.usersService.checkUser(calleeId),
        ]);

        const blocked = await this.relationshipsService.checkIsBlocked(
            callerId,
            calleeId,
        );
        if (blocked) {
            throw new BadRequestException(CALL_MESSAGES.CALL_FORBIDDEN);
        }

        const isFriend = await this.relationshipsService.checkIsFriend(
            callerId,
            calleeId,
        );
        if (!isFriend) {
            throw new BadRequestException(CALL_MESSAGES.CALL_FORBIDDEN);
        }

        const { conversation } =
            await this.conversationsService.getConversationOrThrow(
                conversationId,
            );
        if (conversation.isGroup) {
            throw new BadRequestException(CALL_MESSAGES.CALL_NOT_SUPPORT_GROUP);
        }
        this.conversationsService.ensureMemberInConversation(
            conversation,
            callerId,
        );
        this.conversationsService.ensureMemberInConversation(
            conversation,
            calleeId,
        );

        return this.callModel.create({
            callerId: callerObjectId,
            calleeId: calleeObjectId,
            conversationId: objectConversationId,
            callType,
            status: CallStatusEnum.CALLING,
        });
    }

    /**
     * Người nhận chuyển cuộc gọi từ trạng thái `calling` sang `accepted` khi người nhận bắt máy.
     */
    async acceptCall(callId: string, currentUserId: string) {
        const objectCallId = toObjectId(callId, 'call id');
        const call = await this.callModel.findOneAndUpdate(
            {
                _id: objectCallId,
                status: CallStatusEnum.CALLING,
                calleeId: toObjectId(currentUserId, 'current user id'),
            },
            {
                $set: {
                    status: CallStatusEnum.ACCEPTED,
                    startedAt: new Date(),
                },
            },
            { returnDocument: 'after' },
        );
        if (!call) {
            const existingCall = await this.callModel.findById(objectCallId);
            if (!existingCall) {
                throw new NotFoundException(CALL_MESSAGES.CALL_NOT_FOUND);
            }
            if (existingCall.calleeId.toString() !== currentUserId) {
                throw new BadRequestException(CALL_MESSAGES.CALL_FORBIDDEN);
            }
            throw new BadRequestException(CALL_MESSAGES.ALREADY_ENDED);
        }
        return call;
    }

    /**
     * Người nhận từ chối cuộc gọi chuyển trạng thái `rejected`.
     */
    async rejectCall(callId: string, currentUserId: string) {
        const objectCallId = toObjectId(callId, 'call id');
        const call = await this.callModel.findOneAndUpdate(
            {
                _id: objectCallId,
                status: CallStatusEnum.CALLING,
                calleeId: toObjectId(currentUserId, 'current user id'),
            },
            {
                $set: {
                    status: CallStatusEnum.REJECTED,
                    endedAt: new Date(),
                    duration: 0,
                    endReason: CallEndReasonEnum.CALLEE_REJECT,
                },
            },
            { returnDocument: 'after' },
        );
        if (!call) {
            const existingCall = await this.callModel.findById(objectCallId);
            if (!existingCall) {
                throw new NotFoundException(CALL_MESSAGES.CALL_NOT_FOUND);
            }
            if (existingCall.calleeId.toString() !== currentUserId) {
                throw new BadRequestException(CALL_MESSAGES.CALL_FORBIDDEN);
            }
            throw new BadRequestException(CALL_MESSAGES.ALREADY_ENDED);
        }
        await this.createCallMessage(call);
        return call;
    }

    /**
     * Kết thúc cuộc gọi và tính duration dựa trên thời điểm bắt đầu.
     */
    async endCall(
        callId: string,
        currentUserId: string,
        endReason: CallEndReasonEnum,
    ) {
        const objectCallId = toObjectId(callId, 'call id');
        const existingCall = await this.callModel.findById(objectCallId);
        if (!existingCall) {
            throw new NotFoundException(CALL_MESSAGES.CALL_NOT_FOUND);
        }
        if (
            existingCall.callerId.toString() !== currentUserId &&
            existingCall.calleeId.toString() !== currentUserId
        ) {
            throw new BadRequestException(CALL_MESSAGES.CALL_FORBIDDEN);
        }
        if (existingCall.status === CallStatusEnum.ENDED) {
            await this.createCallMessage(existingCall);
            return existingCall;
        }

        const endedAt = new Date();
        const duration = existingCall.startedAt
            ? Math.max(
                  0,
                  Math.floor(
                      (endedAt.getTime() - existingCall.startedAt.getTime()) /
                          1000,
                  ),
              )
            : 0;

        const call = await this.callModel.findOneAndUpdate(
            {
                _id: objectCallId,
                status: {
                    $in: [CallStatusEnum.CALLING, CallStatusEnum.ACCEPTED],
                },
                $or: [
                    { callerId: toObjectId(currentUserId, 'current user id') },
                    { calleeId: toObjectId(currentUserId, 'current user id') },
                ],
            },
            {
                $set: {
                    endedAt,
                    duration,
                    status: CallStatusEnum.ENDED,
                    endReason,
                },
            },
            { returnDocument: 'after' },
        );
        if (!call) {
            throw new BadRequestException(CALL_MESSAGES.ALREADY_ENDED);
        }
        await this.createCallMessage(call);
        return call;
    }

    /**
     * Đánh dấu cuộc gọi là nhỡ nếu người nhận không phản hồi trong thời gian chờ.
     */
    async markMissed(callId: string) {
        const call = await this.callModel.findOneAndUpdate(
            {
                _id: toObjectId(callId, 'call id'),
                status: CallStatusEnum.CALLING,
            },
            {
                $set: {
                    status: CallStatusEnum.MISSED,
                    endedAt: new Date(),
                    duration: 0,
                    endReason: CallEndReasonEnum.TIMEOUT,
                },
            },
            { returnDocument: 'after' },
        );
        if (!call) {
            const existingCall = await this.callModel.findById(callId);
            if (existingCall?.status === CallStatusEnum.MISSED) {
                await this.createCallMessage(existingCall);
            }
            return existingCall;
        }
        await this.createCallMessage(call);
        return call;
    }

    /**
     * Tạo một tin nhắn mô tả trạng thái cuộc gọi
     */
    async createMissingCallMessages() {
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        const calls = await this.callModel
            .find({
                status: {
                    $in: [
                        CallStatusEnum.ENDED,
                        CallStatusEnum.MISSED,
                        CallStatusEnum.REJECTED,
                    ],
                },
                endedAt: { $gte: twoDaysAgo, $lte: new Date() },
            })
            .sort({ endedAt: 1 });

        for (let i = 0; i < calls.length; i += 10) {
            const batch = calls.slice(i, i + 10);

            await Promise.all(
                batch.map(async (call) => {
                    const message = await this.messageModel
                        .exists({ callId: call._id })
                        .lean();

                    if (!message) {
                        await this.createCallMessage(call);
                    }
                }),
            );
        }
    }

    private async createCallMessage(call: CallDocument) {
        const session = await this.connection.startSession();
        try {
            await session.withTransaction(async () => {
                const messages = await this.messageModel.create(
                    [
                        {
                            conversationId: call.conversationId,
                            senderId: call.callerId,
                            type:
                                call.callType === CallTypeEnum.AUDIO
                                    ? MessageEnumType.CALL_AUDIO
                                    : MessageEnumType.CALL_VIDEO,
                            callId: call._id,
                        },
                    ],
                    { session },
                );

                await this.conversationsService.updateLastMessageAndRestoreConversation(
                    call.conversationId.toString(),
                    messages[0]._id.toString(),
                    call.callerId.toString(),
                    session,
                );
            });
        } catch (error) {
            if ((error as { code?: number }).code === 11000) {
                return;
            }
            throw error;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Lấy lịch sử cuộc gọi theo conversation, sắp xếp mới nhất trước.
     */
    async findByConversation(conversationId: string, limit = 20) {
        return this.callModel
            .find({ conversationId: new Types.ObjectId(conversationId) })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
    }
}
