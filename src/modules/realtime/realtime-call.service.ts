/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-misused-promises */
import { getRoomNameUser, validateObjectId } from '@/utils/utils';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { RedisService } from '@/redis/redis.service';
import { CallService } from '../calls/call.service';
import { CallEndReasonEnum, CallStatusEnum } from '../calls/types/call';
import { RealtimeAuthService } from './realtime-auth.service';
import {
    CallIdSocketDto,
    CallAnswerSocketDto,
    CallIceCandidateSocketDto,
    CallOfferSocketDto,
    EndCallSocketDto,
    StartCallSocketDto,
} from './dto/call-socket.dto';
import {
    CallAckResult,
    CallTokenPayload,
    SignalAckResult,
    SocketResponse,
} from './types/responseSocket';
import { REALTIME_CONSTANT } from './constants/realtime.constant';
import {
    CALL_MESSAGES,
    CALL_RATE_LIMIT_CONSTANT,
} from '../calls/constants/call.constant';

@Injectable()
export class RealtimeCallService {
    private readonly callTimeoutTimers = new Map<
        string,
        ReturnType<typeof setTimeout>
    >();

    constructor(
        private readonly realtimeAuthService: RealtimeAuthService,
        private readonly callService: CallService,
        private readonly redisService: RedisService,
        private readonly configService: ConfigService,
        private readonly jwtService: JwtService,
    ) {}

    private clearCallTimeout(callId: string) {
        const timer = this.callTimeoutTimers.get(callId);
        if (!timer) {
            return;
        }

        clearTimeout(timer);
        this.callTimeoutTimers.delete(callId);
    }

    private scheduleCallTimeout(
        server: Server,
        callId: string,
        conversationId: string,
    ) {
        this.clearCallTimeout(callId);

        const timer = setTimeout(async () => {
            this.callTimeoutTimers.delete(callId);

            try {
                const call = await this.callService.markMissed(callId);
                if (!call || call.status !== CallStatusEnum.MISSED) {
                    return;
                }

                const payload = {
                    callId: call._id.toString(),
                    conversationId,
                    endedBy: call.calleeId.toString(),
                    endReason: CallEndReasonEnum.TIMEOUT,
                };

                server
                    .to(getRoomNameUser(call.callerId.toString()))
                    .emit('call:ended', payload);
                server
                    .to(getRoomNameUser(call.calleeId.toString()))
                    .emit('call:ended', payload);
            } catch {
                // Nếu timeout job lỗi, call vẫn đã được đóng ở tầng service khi có thể.
            }
        }, REALTIME_CONSTANT.CALL_RING_TIMEOUT_MS);

        this.callTimeoutTimers.set(callId, timer);
    }

    private async ensureCurrentUserInCallAndStatus(
        callId: string,
        currentUserId: string,
        status: CallStatusEnum,
    ) {
        validateObjectId(callId, 'callId');
        validateObjectId(currentUserId, 'currentUserId');
        const call = await this.callService.findById(callId);
        if (!call) {
            throw new BadRequestException(CALL_MESSAGES.CALL_NOT_FOUND);
        }
        if (call.status !== status) {
            throw new BadRequestException(CALL_MESSAGES.ALREADY_ENDED);
        }
        if (
            call.callerId.toString() !== currentUserId &&
            call.calleeId.toString() !== currentUserId
        ) {
            throw new BadRequestException(CALL_MESSAGES.USER_NOT_ALLOWED);
        }
        return call;
    }

    private ensureCallMatchesConversation(
        callConversationId: string,
        bodyConversationId: string,
    ) {
        validateObjectId(bodyConversationId, 'conversationId');
        if (callConversationId !== bodyConversationId) {
            throw new BadRequestException(CALL_MESSAGES.CALL_FORBIDDEN);
        }
    }

    private async createCallToken(call: {
        _id: { toString(): string };
        conversationId: { toString(): string };
        callerId: { toString(): string };
        calleeId: { toString(): string };
    }) {
        return await this.jwtService.signAsync(
            {
                callId: call._id.toString(),
                conversationId: call.conversationId.toString(),
                callerId: call.callerId.toString(),
                calleeId: call.calleeId.toString(),
            } satisfies CallTokenPayload,
            {
                secret: this.configService.get<string>('JWT_SECRET'),
                expiresIn: '60s',
            },
        );
    }

    private async ensureValidCallToken(
        call: {
            _id: { toString(): string };
            conversationId: { toString(): string };
            callerId: { toString(): string };
            calleeId: { toString(): string };
        },
        callToken: string,
        currentUserId: string,
    ) {
        const payload = (await this.jwtService.verifyAsync(callToken, {
            secret: this.configService.get<string>('JWT_SECRET'),
        })) as CallTokenPayload;

        if (
            payload.callId !== call._id.toString() ||
            payload.conversationId !== call.conversationId.toString() ||
            payload.callerId !== call.callerId.toString() ||
            payload.calleeId !== call.calleeId.toString()
        ) {
            throw new BadRequestException(CALL_MESSAGES.CALL_FORBIDDEN);
        }

        if (
            currentUserId !== call.callerId.toString() &&
            currentUserId !== call.calleeId.toString()
        ) {
            throw new BadRequestException(CALL_MESSAGES.USER_NOT_ALLOWED);
        }
    }

    private getCallRateLimitKey(userId: string) {
        return `call:rate-limit:start:${userId}`;
    }

    private getCallRateLimitLockKey(userId: string) {
        return `call:rate-limit:lock:${userId}`;
    }

    private async ensureStartCallRateLimit(userId: string) {
        const lockKey = this.getCallRateLimitLockKey(userId);
        const locked = await this.redisService.get(lockKey);
        if (locked) {
            throw new BadRequestException(CALL_MESSAGES.CALL_RATE_LIMITED);
        }

        const rateKey = this.getCallRateLimitKey(userId);
        const count = await this.redisService.incrWithTTL(
            rateKey,
            CALL_RATE_LIMIT_CONSTANT.START_LIMIT_WINDOW_SECONDS,
        );
        if (count > CALL_RATE_LIMIT_CONSTANT.START_LIMIT_COUNT) {
            await this.redisService.setWithTTL(
                lockKey,
                'locked',
                CALL_RATE_LIMIT_CONSTANT.START_LOCK_SECONDS,
            );
            throw new BadRequestException(CALL_MESSAGES.CALL_RATE_LIMITED);
        }
    }

    /**
     * Tạo cuộc gọi mới và phát tín hiệu incoming call cho người nhận.
     */
    async startCall(
        server: Server,
        client: Socket,
        body: StartCallSocketDto,
    ): Promise<SocketResponse<CallAckResult>> {
        const payload =
            await this.realtimeAuthService.validateActiveSession(client);

        await this.ensureStartCallRateLimit(payload._id);

        const [callerActiveCall, calleeActiveCall] = await Promise.all([
            this.callService.findActiveCallByUserId(payload._id),
            this.callService.findActiveCallByUserId(body.calleeId),
        ]);
        if (callerActiveCall || calleeActiveCall) {
            throw new BadRequestException(CALL_MESSAGES.CALL_BUSY);
        }

        const call = await this.callService.createCall({
            callerId: payload._id,
            calleeId: body.calleeId,
            conversationId: body.conversationId,
            callType: body.callType,
        });
        const callToken = await this.createCallToken(call);

        const calleeRoom = getRoomNameUser(body.calleeId);
        server.to(calleeRoom).emit('call:incoming', {
            callId: call._id.toString(),
            callerId: payload._id,
            calleeId: body.calleeId,
            conversationId: body.conversationId,
            callType: body.callType,
            callToken,
        });
        this.scheduleCallTimeout(
            server,
            call._id.toString(),
            body.conversationId,
        );

        return {
            ok: true,
            data: {
                callId: call._id.toString(),
                conversationId: body.conversationId,
                callToken,
            },
        };
    }

    /**
     * Xác nhận cuộc gọi đang chờ và báo lại cho người gọi.
     */
    async acceptCall(
        server: Server,
        client: Socket,
        body: CallIdSocketDto,
    ): Promise<SocketResponse<CallAckResult>> {
        const payload =
            await this.realtimeAuthService.validateActiveSession(client);
        const call = await this.callService.acceptCall(
            body.callId,
            payload._id,
        );
        this.clearCallTimeout(call._id.toString());
        const callToken = await this.createCallToken(call);

        const callerRoom = getRoomNameUser(call.callerId.toString());
        const calleeRoom = getRoomNameUser(call.calleeId.toString());
        server.to(callerRoom).emit('call:accepted', {
            callId: call._id.toString(),
            conversationId: call.conversationId.toString(),
            acceptedBy: payload._id,
            acceptedBySocketId: client.id,
            callToken,
        });
        server.to(calleeRoom).emit('call:close', {
            callId: call._id.toString(),
            conversationId: call.conversationId.toString(),
            acceptedBy: payload._id,
            acceptedBySocketId: client.id,
            reason: 'accepted',
        });

        return {
            ok: true,
            data: {
                callId: call._id.toString(),
                conversationId: call.conversationId.toString(),
                callToken,
            },
        };
    }

    /**
     * Từ chối cuộc gọi đang chờ và báo lại cho người gọi.
     */
    async rejectCall(
        server: Server,
        client: Socket,
        body: CallIdSocketDto,
    ): Promise<SocketResponse<CallAckResult>> {
        const payload =
            await this.realtimeAuthService.validateActiveSession(client);
        const call = await this.callService.rejectCall(
            body.callId,
            payload._id,
        );
        this.clearCallTimeout(call._id.toString());

        const callerRoom = getRoomNameUser(call.callerId.toString());
        const calleeRoom = getRoomNameUser(call.calleeId.toString());
        server.to(callerRoom).emit('call:rejected', {
            callId: call._id.toString(),
            conversationId: call.conversationId.toString(),
            rejectedBy: payload._id,
        });
        server.to(calleeRoom).emit('call:close', {
            callId: call._id.toString(),
            conversationId: call.conversationId.toString(),
            rejectedBy: payload._id,
            reason: 'rejected',
        });

        return {
            ok: true,
            data: {
                callId: call._id.toString(),
                conversationId: call.conversationId.toString(),
            },
        };
    }

    /**
     * Kết thúc cuộc gọi và broadcast trạng thái cuối cho conversation room.
     */
    async endCall(
        server: Server,
        client: Socket,
        body: EndCallSocketDto,
    ): Promise<SocketResponse<CallAckResult>> {
        const payload =
            await this.realtimeAuthService.validateActiveSession(client);
        const call = await this.callService.endCall(
            body.callId,
            payload._id,
            body.endReason,
        );
        this.clearCallTimeout(call._id.toString());

        const callerRoom = getRoomNameUser(call.callerId.toString());
        const calleeRoom = getRoomNameUser(call.calleeId.toString());
        server.to(callerRoom).emit('call:ended', {
            callId: call._id.toString(),
            conversationId: call.conversationId.toString(),
            endedBy: payload._id,
            endReason: body.endReason,
        });
        server.to(calleeRoom).emit('call:ended', {
            callId: call._id.toString(),
            conversationId: call.conversationId.toString(),
            endedBy: payload._id,
            endReason: body.endReason,
        });
        server.to(calleeRoom).emit('call:close', {
            callId: call._id.toString(),
            conversationId: call.conversationId.toString(),
            endedBy: payload._id,
            endReason: body.endReason,
            reason: 'ended',
        });

        return {
            ok: true,
            data: {
                callId: call._id.toString(),
                conversationId: call.conversationId.toString(),
            },
        };
    }

    /**
     * Chuyển SDP offer sang phía còn lại của cuộc gọi.
     */
    async forwardOffer(
        server: Server,
        client: Socket,
        body: CallOfferSocketDto,
    ): Promise<SocketResponse<SignalAckResult>> {
        const payload =
            await this.realtimeAuthService.validateActiveSession(client);

        const call = await this.ensureCurrentUserInCallAndStatus(
            body.callId,
            payload._id,
            CallStatusEnum.ACCEPTED,
        );
        this.ensureCallMatchesConversation(
            call.conversationId.toString(),
            body.conversationId,
        );
        await this.ensureValidCallToken(call, body.callToken, payload._id);

        const targetRoom =
            payload._id === call.callerId.toString()
                ? getRoomNameUser(call.calleeId.toString())
                : getRoomNameUser(call.callerId.toString());
        client.to(targetRoom).emit('call:offer', {
            callId: body.callId,
            conversationId: body.conversationId,
            fromUserId: payload._id,
            offer: body.offer,
        });

        return {
            ok: true,
            data: {
                forwarded: true,
            },
        };
    }

    /**
     * Chuyển SDP answer sang phía còn lại của cuộc gọi.
     */
    async forwardAnswer(
        server: Server,
        client: Socket,
        body: CallAnswerSocketDto,
    ): Promise<SocketResponse<SignalAckResult>> {
        const payload =
            await this.realtimeAuthService.validateActiveSession(client);
        const call = await this.ensureCurrentUserInCallAndStatus(
            body.callId,
            payload._id,
            CallStatusEnum.ACCEPTED,
        );
        this.ensureCallMatchesConversation(
            call.conversationId.toString(),
            body.conversationId,
        );
        await this.ensureValidCallToken(call, body.callToken, payload._id);
        const targetRoom =
            payload._id === call.callerId.toString()
                ? getRoomNameUser(call.calleeId.toString())
                : getRoomNameUser(call.callerId.toString());
        client.to(targetRoom).emit('call:answer', {
            callId: body.callId,
            conversationId: body.conversationId,
            fromUserId: payload._id,
            answer: body.answer,
        });

        return {
            ok: true,
            data: {
                forwarded: true,
            },
        };
    }

    /**
     * Chuyển ICE candidate sang phía còn lại của cuộc gọi.
     */
    async forwardIceCandidate(
        server: Server,
        client: Socket,
        body: CallIceCandidateSocketDto,
    ): Promise<SocketResponse<SignalAckResult>> {
        const payload =
            await this.realtimeAuthService.validateActiveSession(client);
        const call = await this.ensureCurrentUserInCallAndStatus(
            body.callId,
            payload._id,
            CallStatusEnum.ACCEPTED,
        );
        this.ensureCallMatchesConversation(
            call.conversationId.toString(),
            body.conversationId,
        );
        await this.ensureValidCallToken(call, body.callToken, payload._id);
        const targetRoom =
            payload._id === call.callerId.toString()
                ? getRoomNameUser(call.calleeId.toString())
                : getRoomNameUser(call.callerId.toString());
        client.to(targetRoom).emit('call:ice-candidate', {
            callId: body.callId,
            conversationId: body.conversationId,
            fromUserId: payload._id,
            candidate: body.candidate,
        });

        return {
            ok: true,
            data: {
                forwarded: true,
            },
        };
    }
}
