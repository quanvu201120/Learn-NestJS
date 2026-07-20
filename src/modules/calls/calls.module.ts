import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Call, CallSchema } from './schemas/call.schema';
import { CallService } from './call.service';
import { UsersModule } from '../users/users.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { RelationshipsModule } from '../relationships/relationships.module';
import { Message, MessageSchema } from '../messages/schemas/message.schema';
import { CallMessageReconcileCron } from './cron/call-message-reconcile.cron';
import { MessagesModule } from '../messages/messages.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Call.name, schema: CallSchema },
            { name: Message.name, schema: MessageSchema },
        ]),
        forwardRef(() => UsersModule),
        forwardRef(() => ConversationsModule),
        forwardRef(() => RelationshipsModule),
        forwardRef(() => MessagesModule),
    ],
    providers: [CallService, CallMessageReconcileCron],
    exports: [CallService],
})
export class CallsModule {}
