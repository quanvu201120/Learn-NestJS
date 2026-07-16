import { forwardRef, Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Message, MessageSchema } from './schemas/message.schema';
import { MessageLookupService } from './message-lookup.service';
import { MessageEventService } from './message-event.service';
import { MessageCommandService } from './message-command.service';
import { MessageMediaService } from './message-media.service';
import { MessagePinService } from './message-pin.service';
import { MessageQueryService } from './message-query.service';
import { MessageReactionService } from './message-reaction.service';
import { MessageRealtimeService } from './message-realtime.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { MediaModule } from '../media/media.module';
import { RelationshipsModule } from '../relationships/relationships.module';
import { StatsModule } from '../stats/stats.module';
import { UsersModule } from '../users/users.module';
import { RedisModule } from '@/redis/redis.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Message.name, schema: MessageSchema },
        ]),
        forwardRef(() => ConversationsModule),
        forwardRef(() => MediaModule),
        forwardRef(() => RelationshipsModule),
        forwardRef(() => UsersModule),
        forwardRef(() => StatsModule),
        forwardRef(() => RedisModule),
    ],
    controllers: [MessagesController],
    providers: [
        MessagesService,
        MessageEventService,
        MessageCommandService,
        MessageLookupService,
        MessageQueryService,
        MessageMediaService,
        MessageRealtimeService,
        MessageReactionService,
        MessagePinService,
    ],
    exports: [MessagesService],
})
export class MessagesModule {}
