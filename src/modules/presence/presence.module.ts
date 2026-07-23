import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PresenceService } from './presence.service';
import { PresenceController } from './presence.controller';
import { RedisModule } from '@/redis/redis.module';
import {
    Conversation,
    ConversationSchema,
} from '../conversations/schemas/conversation.schema';

@Module({
    imports: [
        RedisModule,
        MongooseModule.forFeature([
            { name: Conversation.name, schema: ConversationSchema },
        ]),
    ],
    controllers: [PresenceController],
    providers: [PresenceService],
    exports: [PresenceService],
})
export class PresenceModule {}
