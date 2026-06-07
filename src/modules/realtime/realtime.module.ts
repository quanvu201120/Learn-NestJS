import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { AuthModule } from '@/auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
    imports: [AuthModule, ConversationsModule, MessagesModule],
    exports: [ChatGateway],
    providers: [ChatGateway],
})
export class RealtimeModule {}
