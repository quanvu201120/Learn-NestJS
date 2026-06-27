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
    providers: [RelationshipsService],
    exports: [RelationshipsService],
})
export class RelationshipsModule {}
