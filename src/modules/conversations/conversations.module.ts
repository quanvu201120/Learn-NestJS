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
import { MediaModule } from '../media/media.module';
import { RelationshipsModule } from '../relationships/relationships.module';
import { StatsModule } from '../stats/stats.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Conversation.name, schema: ConversationSchema },
        ]),
        forwardRef(() => MessagesModule),
        forwardRef(() => UsersModule),
        forwardRef(() => RelationshipsModule),
        MediaModule,
        StatsModule,
    ],
    controllers: [ConversationsController],
    providers: [ConversationsService],
    exports: [ConversationsService],
})
export class ConversationsModule {}
