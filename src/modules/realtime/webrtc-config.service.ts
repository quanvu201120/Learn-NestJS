import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type MeteredIceServer = {
    urls: string | string[];
    username?: string;
    credential?: string;
};

@Injectable()
export class WebrtcConfigService {
    constructor(private readonly configService: ConfigService) {}

    async getIceServers(): Promise<MeteredIceServer[]> {
        const apiKey = this.configService.get<string>('METERED_API_KEY');
        if (!apiKey) {
            throw new InternalServerErrorException(
                'METERED_API_KEY is not configured',
            );
        }

        const baseUrl = this.configService.get<string>(
            'METERED_ICE_SERVERS_URL',
        );

        const response = await fetch(`${baseUrl}?apiKey=${apiKey}`);
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

        return iceServers;
    }
}
