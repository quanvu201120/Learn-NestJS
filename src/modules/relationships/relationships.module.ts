import { Module, forwardRef } from '@nestjs/common';
import { RelationshipsService } from './relationships.service';
import { RelationshipsController } from './relationships.controller';
import { MongooseModule } from '@nestjs/mongoose';
import {
    Relationship,
    RelationshipSchema,
} from './schemas/relationship.schema';
import { UsersModule } from '../users/users.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { RelationshipAccessService } from './relationship-access.service';
import { RelationshipBlockService } from './relationship-block.service';
import { RelationshipQueryService } from './relationship-query.service';
import { RelationshipRequestService } from './relationship-request.service';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Relationship.name, schema: RelationshipSchema },
        ]),
        forwardRef(() => UsersModule),
        forwardRef(() => ConversationsModule),
        forwardRef(() => MessagesModule),
    ],
    controllers: [RelationshipsController],
    providers: [
        RelationshipsService,
        RelationshipAccessService,
        RelationshipBlockService,
        RelationshipQueryService,
        RelationshipRequestService,
    ],
    exports: [RelationshipsService],
})
export class RelationshipsModule {}
