import { CALL_MESSAGES } from './constants/call.constant';
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Call, CallDocument } from './schemas/call.schema';
import { CallEndReasonEnum, CallStatusEnum, CallTypeEnum } from './types/call';
import { UsersService } from '../users/users.service';
import { ConversationsService } from '../conversations/conversations.service';
import { RelationshipsService } from '../relationships/relationships.service';
import { toObjectId } from '@/utils/utils';

@Injectable()
export class CallService {
    constructor(
        @InjectModel(Call.name)
        private readonly callModel: Model<CallDocument>,
        private readonly usersService: UsersService,
        private readonly conversationsService: ConversationsService,
        private readonly relationshipsService: RelationshipsService,
    ) {}

    async findById(callId: string) {
        return this.callModel.findById(toObjectId(callId, 'callId'));
    }

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

        const conversation =
            await this.conversationsService.getConversationOrThrow(
                conversationId,
            );
        this.conversationsService.ensureMemberInConversation(
            conversation.conversation,
            callerId,
        );
        this.conversationsService.ensureMemberInConversation(
            conversation.conversation,
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
        const call = await this.callModel.findById(objectCallId);
        if (!call) {
            throw new NotFoundException(CALL_MESSAGES.CALL_NOT_FOUND);
        }
        if (call.status !== CallStatusEnum.CALLING) {
            throw new BadRequestException(CALL_MESSAGES.ALREADY_ENDED);
        }
        if (call.calleeId.toString() !== currentUserId) {
            throw new BadRequestException(CALL_MESSAGES.CALL_FORBIDDEN);
        }

        call.status = CallStatusEnum.ACCEPTED;
        call.startedAt = call.startedAt || new Date();
        await call.save();
        return call;
    }

    /**
     * Người nhận từ chối cuộc gọi chuyển trạng thái `rejected`.
     */
    async rejectCall(callId: string, currentUserId: string) {
        const objectCallId = toObjectId(callId, 'call id');
        const call = await this.callModel.findById(objectCallId);
        if (!call) {
            throw new NotFoundException(CALL_MESSAGES.CALL_NOT_FOUND);
        }
        if (call.status !== CallStatusEnum.CALLING) {
            throw new BadRequestException(CALL_MESSAGES.ALREADY_ENDED);
        }
        if (call.calleeId.toString() !== currentUserId) {
            throw new BadRequestException(CALL_MESSAGES.CALL_FORBIDDEN);
        }

        call.status = CallStatusEnum.REJECTED;
        call.endedAt = new Date();
        call.duration = 0;
        call.endReason = CallEndReasonEnum.CALLEE_REJECT;
        await call.save();
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
        const call = await this.callModel.findById(objectCallId);
        if (!call) {
            throw new NotFoundException(CALL_MESSAGES.CALL_NOT_FOUND);
        }
        if (
            call.callerId.toString() !== currentUserId &&
            call.calleeId.toString() !== currentUserId
        ) {
            throw new BadRequestException(CALL_MESSAGES.CALL_FORBIDDEN);
        }
        if (call.status === CallStatusEnum.ENDED) {
            return call;
        }

        const endedAt = new Date();
        call.endedAt = endedAt;
        call.duration = call.startedAt
            ? Math.max(
                  0,
                  Math.floor(
                      (endedAt.getTime() - call.startedAt.getTime()) / 1000,
                  ),
              )
            : 0;
        call.status = CallStatusEnum.ENDED;
        call.endReason = endReason;
        await call.save();
        return call;
    }

    /**
     * Đánh dấu cuộc gọi là nhỡ nếu người nhận không phản hồi trong thời gian chờ.
     */
    async markMissed(callId: string) {
        const call = await this.callModel.findById(callId);
        if (!call) {
            throw new NotFoundException(CALL_MESSAGES.CALL_NOT_FOUND);
        }
        if (call.status !== CallStatusEnum.CALLING) {
            return call;
        }
        call.status = CallStatusEnum.MISSED;
        call.endedAt = new Date();
        call.duration = 0;
        call.endReason = CallEndReasonEnum.TIMEOUT;
        await call.save();
        return call;
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
