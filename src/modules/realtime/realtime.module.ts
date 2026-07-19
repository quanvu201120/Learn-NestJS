import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { AuthModule } from '@/auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { RedisModule } from '@/redis/redis.module';
import { UsersModule } from '../users/users.module';
import { SessionModule } from '../session/session.module';
import { RelationshipsModule } from '../relationships/relationships.module';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeChatCommandService } from './realtime-chat-command.service';
import { RealtimeEventBridgeService } from './realtime-event-bridge.service';
import { CallsModule } from '../calls/calls.module';
import { RealtimeCallService } from './realtime-call.service';
import { PushSubscriptionsModule } from '../push-subscriptions/push-subscriptions.module';
@Module({
    imports: [
        AuthModule,
        ConversationsModule,
        MessagesModule,
        RedisModule,
        UsersModule,
        SessionModule,
        RelationshipsModule,
        CallsModule,
        PushSubscriptionsModule,
    ],
    exports: [ChatGateway],
    providers: [
        ChatGateway,
        RealtimeAuthService,
        RealtimeChatCommandService,
        RealtimeEventBridgeService,
        RealtimeCallService,
    ],
})
export class RealtimeModule {}
