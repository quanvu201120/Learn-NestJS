import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@/redis/redis.service';
import { REALTIME_CONSTANT } from './constants/realtime.constant';

type MeteredIceServer = {
    urls: string | string[];
    username?: string;
    credential?: string;
};

@Injectable()
export class WebrtcConfigService {
    constructor(
        private readonly configService: ConfigService,
        private readonly redisService: RedisService,
    ) {}

    async getIceServers(forceRefresh = false): Promise<MeteredIceServer[]> {
        const cached = forceRefresh
            ? null
            : await this.redisService.get(
                  REALTIME_CONSTANT.ICE_SERVERS_CACHE_KEY,
              );
        if (cached) {
            try {
                return JSON.parse(cached) as MeteredIceServer[];
            } catch {
                // cache hỏng, bỏ qua và lấy dữ liệu mới
            }
        }

        const apiKey = this.configService.get<string>('METERED_API_KEY');
        if (!apiKey) {
            throw new InternalServerErrorException(
                'METERED_API_KEY is not configured',
            );
        }

        const baseUrl = this.configService.get<string>(
            'METERED_ICE_SERVERS_URL',
        );
        const expirySeconds = REALTIME_CONSTANT.METERED_ICE_EXPIRY_SECONDS;

        const response = await fetch(
            `${baseUrl}?apiKey=${apiKey}&expiryInSeconds=${expirySeconds}`,
        );
        if (!response.ok) {
            throw new InternalServerErrorException(
                'Failed to load WebRTC ICE servers',
            );
        }

        const data = (await response.json()) as
            | MeteredIceServer[]
            | {
                  iceServers?: MeteredIceServer[];
                  data?: MeteredIceServer[];
              };

        const iceServers = Array.isArray(data)
            ? data
            : Array.isArray(data.iceServers)
              ? data.iceServers
              : Array.isArray(data.data)
                ? data.data
                : null;

        if (!iceServers) {
            throw new InternalServerErrorException(
                'Invalid ICE servers response',
            );
        }

        await this.redisService.setWithTTL(
            REALTIME_CONSTANT.ICE_SERVERS_CACHE_KEY,
            JSON.stringify(iceServers),
            expirySeconds,
        );

        return iceServers;
    }
}
