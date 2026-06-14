import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { AuthModule } from '@/auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { RedisModule } from '@/redis/redis.module';
import { UsersModule } from '../users/users.module';
import { SessionModule } from '../session/session.module';

@Module({
    imports: [
        AuthModule,
        ConversationsModule,
        MessagesModule,
        RedisModule,
        UsersModule,
        SessionModule,
    ],
    exports: [ChatGateway],
    providers: [ChatGateway],
})
export class RealtimeModule {}
