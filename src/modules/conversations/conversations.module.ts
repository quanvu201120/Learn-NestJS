import { forwardRef, Module } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { MongooseModule } from '@nestjs/mongoose';
import {
    Conversation,
    ConversationSchema,
} from './schemas/conversation.schema';
import { MessagesModule } from '../messages/messages.module';
import { UsersModule } from '../users/users.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Conversation.name, schema: ConversationSchema },
        ]),
        forwardRef(() => MessagesModule),
        forwardRef(() => UsersModule),
    ],
    controllers: [ConversationsController],
    providers: [ConversationsService],
    exports: [ConversationsService],
})
export class ConversationsModule {}
