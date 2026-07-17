/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-misused-promises */
import { getRoomNameUser, validateObjectId } from '@/utils/utils';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Cron } from '@nestjs/schedule';
import { Server, Socket } from 'socket.io';
import { RedisService } from '@/redis/redis.service';
import { CallService } from '../calls/call.service';
import { CallEndReasonEnum, CallStatusEnum } from '../calls/types/call';
import { RealtimeAuthService } from './realtime-auth.service';
import {
    CallIdSocketDto,
    CallAnswerSocketDto,
    CallHeartbeatSocketDto,
    CallIceCandidateSocketDto,
    CallOfferSocketDto,
    EndCallSocketDto,
    StartCallSocketDto,
} from './dto/call-socket.dto';
import {
    CallHeartbeatResult,
    CallAckResult,
    CallTokenPayload,
    SignalAckResult,
    SocketResponse,
} from './types/responseSocket';
import { REALTIME_CONSTANT } from './constants/realtime.constant';
import {
    CALL_HEARTBEAT_CONSTANT,
    CALL_MESSAGES,
    CALL_RATE_LIMIT_CONSTANT,
} from '../calls/constants/call.constant';

@Injectable()
export class RealtimeCallService {
    private readonly logger = new Logger(RealtimeCallService.name);
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

    /**
     * Tạo key Redis dùng để giữ heartbeat cho call đã accepted.
     */
    private getCallAcceptedHeartbeatKey(callId: string) {
        return `call:heartbeat:accepted:${callId}`;
    }

    /**
     * Xóa timer ring-timeout của một call nếu nó còn tồn tại trong bộ nhớ.
     */
    private clearCallTimeout(callId: string) {
        const timer = this.callTimeoutTimers.get(callId);
        if (!timer) {
            return;
        }

        clearTimeout(timer);
        this.callTimeoutTimers.delete(callId);
    }

    /**
     * Gắn call hiện tại cho socket đang thao tác cuộc gọi.
     */
    private setSocketActiveCall(client: Socket, callId: string) {
        client.data.activeCallId = callId;
    }

    /**
     * Gỡ call hiện tại khỏi socket sau khi call đã kết thúc.
     */
    private clearSocketActiveCall(client: Socket) {
        if (client.data.activeCallId) {
            delete client.data.activeCallId;
        }
    }

    /**
     * Tạo danh sách lock key theo thứ tự caller -> callee.
     */
    private getStartCallLockKeys(callerId: string, calleeId: string) {
        return [callerId, calleeId]
            .sort()
            .map((userId) => `call:start:lock:${userId}`);
    }

    /**
     * Giành quyền khóa caller/callee trước lúc start call
     * để không có cuộc gọi nào khác được tạo trùng user.
     */
    private async lockStartCallUsers(lockKeys: string[]) {
        const acquiredKeys: string[] = [];

        for (const lockKey of lockKeys) {
            const acquired = await this.redisService.setIfNotExistsWithTTL(
                lockKey,
                'locked',
                5,
            );
            if (!acquired) {
                await Promise.all(
                    acquiredKeys.map((key) => this.redisService.del(key)),
                );
                throw new BadRequestException(CALL_MESSAGES.CALL_BUSY);
            }
            acquiredKeys.push(lockKey);
        }

        return acquiredKeys;
    }

    /**
     * Đặt timer để tự mark call thành `missed` nếu người nhận không bắt máy đúng hạn.
     */
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

    /**
     * Xác nhận người dùng hiện tại là thành viên của call và call đang ở đúng status mong đợi.
     */
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

    /**
     * Chặn signaling nếu conversation trong payload không khớp với call trong DB.
     */
    private ensureCallMatchesConversation(
        callConversationId: string,
        bodyConversationId: string,
    ) {
        validateObjectId(bodyConversationId, 'conversationId');
        if (callConversationId !== bodyConversationId) {
            throw new BadRequestException(CALL_MESSAGES.CALL_FORBIDDEN);
        }
    }

    /**
     * Gia hạn heartbeat Redis cho call đã accepted.
     */
    private async refreshAcceptedHeartbeat(callId: string) {
        await this.redisService.setWithTTL(
            this.getCallAcceptedHeartbeatKey(callId),
            'alive',
            CALL_HEARTBEAT_CONSTANT.ACCEPT_HEARTBEAT_TTL_SECONDS,
        );
    }

    /**
     * Gia hạn heartbeat cho call đã accepted từ phía callee.
     */
    async refreshCallHeartbeat(
        client: Socket,
        body: CallHeartbeatSocketDto,
    ): Promise<SocketResponse<CallHeartbeatResult>> {
        const payload =
            await this.realtimeAuthService.validateActiveSession(client);
        const call = await this.ensureCurrentUserInCallAndStatus(
            body.callId,
            payload._id,
            CallStatusEnum.ACCEPTED,
        );

        if (call.calleeId.toString() !== payload._id) {
            throw new BadRequestException(CALL_MESSAGES.USER_NOT_ALLOWED);
        }

        await this.refreshAcceptedHeartbeat(call._id.toString());

        return {
            ok: true,
            data: {
                refreshed: true,
            },
        };
    }

    /**
     * Tạo JWT ngắn hạn để ràng buộc signaling theo đúng call/conversation/user.
     */
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

    /**
     * Xác thực JWT call token trước khi cho phép forward signaling WebRTC.
     */
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

    /**
     * Tạo key Redis để đếm số lần start call trong cửa sổ thời gian.
     */
    private getCallRateLimitKey(userId: string) {
        return `call:rate-limit:start:${userId}`;
    }

    /**
     * Tạo key Redis khóa tạm khi user gọi vượt ngưỡng rate limit.
     */
    private getCallRateLimitLockKey(userId: string) {
        return `call:rate-limit:lock:${userId}`;
    }

    /**
     * Áp rate limit cho hành động start call để chặn spam gọi liên tục.
     */
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

        const lockKeys = this.getStartCallLockKeys(payload._id, body.calleeId);
        await this.lockStartCallUsers(lockKeys);

        try {
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
            this.setSocketActiveCall(client, call._id.toString());
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
        } finally {
            await Promise.all(
                lockKeys.map((key) => this.redisService.del(key)),
            );
        }
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
        this.setSocketActiveCall(client, call._id.toString());
        this.clearCallTimeout(call._id.toString());
        await this.refreshAcceptedHeartbeat(call._id.toString());
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
        this.clearSocketActiveCall(client);

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
        await this.redisService.del(
            this.getCallAcceptedHeartbeatKey(call._id.toString()),
        );
        this.clearSocketActiveCall(client);

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
        this.setSocketActiveCall(client, call._id.toString());
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
        this.setSocketActiveCall(client, call._id.toString());
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
        this.setSocketActiveCall(client, call._id.toString());
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

    /**
     * Cron dọn call bị treo:
     * - `calling` quá timeout thì mark `missed`
     * - `accepted` mất heartbeat thì end với `network_lost`
     */
    @Cron('0 * * * * *')
    async cleanupStuckCalls() {
        const now = new Date();
        const staleBefore = new Date(
            now.getTime() - REALTIME_CONSTANT.CALL_RING_TIMEOUT_MS,
        );

        try {
            const staleCallingCalls =
                await this.callService.findStaleCallingCalls(staleBefore);
            await Promise.allSettled(
                staleCallingCalls.map(async (call) => {
                    try {
                        const missed = await this.callService.markMissed(
                            call._id.toString(),
                        );
                        if (
                            !missed ||
                            missed.status !== CallStatusEnum.MISSED
                        ) {
                            return;
                        }

                        this.clearCallTimeout(call._id.toString());
                        await this.redisService.del(
                            this.getCallAcceptedHeartbeatKey(
                                call._id.toString(),
                            ),
                        );
                    } catch (error) {
                        this.logger.warn(
                            `Failed to cleanup stale calling call ${call._id.toString()}: ${(error as Error)?.message || error}`,
                        );
                    }
                }),
            );

            const acceptedCalls = await this.callService.findAcceptedCalls();
            const acceptedCallChecks = await Promise.all(
                acceptedCalls.map(async (call) => ({
                    call,
                    ttl: await this.redisService.ttl(
                        this.getCallAcceptedHeartbeatKey(call._id.toString()),
                    ),
                })),
            );

            await Promise.allSettled(
                acceptedCallChecks.map(async ({ call, ttl }) => {
                    if (ttl > 0) {
                        return;
                    }

                    try {
                        const ended = await this.callService.endCall(
                            call._id.toString(),
                            call.callerId.toString(),
                            CallEndReasonEnum.NETWORK_LOST,
                        );
                        if (!ended || ended.status !== CallStatusEnum.ENDED) {
                            return;
                        }

                        this.clearCallTimeout(call._id.toString());
                        await this.redisService.del(
                            this.getCallAcceptedHeartbeatKey(
                                call._id.toString(),
                            ),
                        );
                        this.logger.debug(
                            `Ended accepted call due to missing heartbeat: ${call._id.toString()}`,
                        );
                    } catch (error) {
                        this.logger.warn(
                            `Failed to cleanup accepted call ${call._id.toString()}: ${(error as Error)?.message || error}`,
                        );
                    }
                }),
            );
        } catch (error) {
            this.logger.error(
                `cleanupStuckCalls failed: ${(error as Error)?.message || error}`,
            );
        }
    }

    /**
     * Khi socket user disconnect, tự kết thúc call active của user đó nếu có.
     */
    async handleDisconnectedUser(
        server: Server,
        userId: string,
        callId: string,
    ) {
        const activeCall = await this.callService.findById(callId);
        if (
            !activeCall ||
            activeCall.status === CallStatusEnum.ENDED ||
            (activeCall.callerId.toString() !== userId &&
                activeCall.calleeId.toString() !== userId)
        ) {
            return;
        }

        const currentUserId = userId.toString();
        const call = await this.callService.endCall(
            activeCall._id.toString(),
            currentUserId,
            CallEndReasonEnum.NETWORK_LOST,
        );

        this.clearCallTimeout(call._id.toString());
        await this.redisService.del(
            this.getCallAcceptedHeartbeatKey(call._id.toString()),
        );

        const callerRoom = getRoomNameUser(call.callerId.toString());
        const calleeRoom = getRoomNameUser(call.calleeId.toString());
        server.to(callerRoom).emit('call:ended', {
            callId: call._id.toString(),
            conversationId: call.conversationId.toString(),
            endedBy: currentUserId,
            endReason: CallEndReasonEnum.NETWORK_LOST,
        });
        server.to(calleeRoom).emit('call:ended', {
            callId: call._id.toString(),
            conversationId: call.conversationId.toString(),
            endedBy: currentUserId,
            endReason: CallEndReasonEnum.NETWORK_LOST,
        });
        server.to(calleeRoom).emit('call:close', {
            callId: call._id.toString(),
            conversationId: call.conversationId.toString(),
            endedBy: currentUserId,
            endReason: CallEndReasonEnum.NETWORK_LOST,
            reason: 'ended',
        });
    }
}
