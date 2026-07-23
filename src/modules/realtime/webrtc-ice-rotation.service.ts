import { getRoomNameUser } from '@/utils/utils';
import { RedisService } from '@/redis/redis.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Server } from 'socket.io';
import { CallService } from '../calls/call.service';
import { REALTIME_CONSTANT, SOCKET_EVENTS } from './constants/realtime.constant';
import { WebrtcConfigService } from './webrtc-config.service';
import { WebSocketServer } from '@nestjs/websockets';

@Injectable()
export class WebrtcIceRotationService {
    private readonly logger = new Logger(WebrtcIceRotationService.name);

    @WebSocketServer()
    private server: Server;

    constructor(
        private readonly redisService: RedisService,
        private readonly webrtcConfigService: WebrtcConfigService,
        private readonly callService: CallService,
    ) {}

    /**
     * Gắn instance Socket.IO Server để service có thể emit; gọi từ
     * `ChatGateway.onModuleInit()` giống pattern của `RealtimeEventBridgeService`.
     */
    register(server: Server) {
        this.server = server;
    }

    /**
     * Kiểm tra cache ICE server sắp hết hạn; nếu có, lấy bản mới và phát cho
     * các user đang trong call `accepted` để họ `restartIce()` mà không rớt cuộc gọi.
     */
    @Cron('0 * * * * *')
    async rotateIceServersForActiveCalls() {
        if (!this.server) {
            return;
        }

        try {
            const ttl = await this.redisService.ttl(
                REALTIME_CONSTANT.ICE_SERVERS_CACHE_KEY,
            );
            if (ttl > REALTIME_CONSTANT.ICE_SERVERS_ROTATE_THRESHOLD_SECONDS) {
                return;
            }

            const iceServers =
                await this.webrtcConfigService.getIceServers(true);
            const acceptedCalls = await this.callService.findAcceptedCalls();
            if (acceptedCalls.length === 0) {
                return;
            }

            acceptedCalls.forEach((call) => {
                const payload = { iceServers };
                this.server
                    .to(getRoomNameUser(call.callerId.toString()))
                    .emit(SOCKET_EVENTS.WEBRTC_ICE_SERVERS_UPDATED, payload);
                this.server
                    .to(getRoomNameUser(call.calleeId.toString()))
                    .emit(SOCKET_EVENTS.WEBRTC_ICE_SERVERS_UPDATED, payload);
            });
        } catch (error) {
            this.logger.warn(
                `rotateIceServersForActiveCalls failed: ${(error as Error)?.message || error}`,
            );
        }
    }
}
