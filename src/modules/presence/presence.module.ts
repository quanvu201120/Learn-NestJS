import { Module } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { PresenceController } from './presence.controller';
import { RedisModule } from '@/redis/redis.module';

@Module({
    imports: [RedisModule],
    controllers: [PresenceController],
    providers: [PresenceService],
    exports: [PresenceService],
})
export class PresenceModule {}
