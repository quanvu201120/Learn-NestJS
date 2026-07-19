import { Controller, Get } from '@nestjs/common';
import { WebrtcConfigService } from './webrtc-config.service';

@Controller('realtime')
export class WebrtcConfigController {
    constructor(private readonly webrtcConfigService: WebrtcConfigService) {}

    @Get('webrtc/ice-servers')
    async getIceServers() {
        return {
            iceServers: await this.webrtcConfigService.getIceServers(),
        };
    }
}
