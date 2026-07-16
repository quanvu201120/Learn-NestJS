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
import { ConversationAccessService } from './conversation-access.service';
import { ConversationCommandService } from './conversation-command.service';
import { ConversationEventService } from './conversation-event.service';
import { ConversationGroupAdminService } from './conversation-group-admin.service';
import { ConversationMediaService } from './conversation-media.service';
import { ConversationMemberService } from './conversation-member.service';
import { ConversationQueryService } from './conversation-query.service';
import { ConversationSerializerService } from './conversation-serializer.service';
import { ConversationStateService } from './conversation-state.service';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Conversation.name, schema: ConversationSchema },
        ]),
        forwardRef(() => MessagesModule),
        forwardRef(() => UsersModule),
        forwardRef(() => RelationshipsModule),
        forwardRef(() => MediaModule),
        forwardRef(() => StatsModule),
    ],
    controllers: [ConversationsController],
    providers: [
        ConversationsService,
        ConversationAccessService,
        ConversationCommandService,
        ConversationEventService,
        ConversationGroupAdminService,
        ConversationMediaService,
        ConversationMemberService,
        ConversationQueryService,
        ConversationSerializerService,
        ConversationStateService,
    ],
    exports: [
        ConversationsService,
        ConversationAccessService,
        ConversationEventService,
    ],
})
export class ConversationsModule {}
