import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Call, CallSchema } from './schemas/call.schema';
import { CallService } from './call.service';
import { UsersModule } from '../users/users.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { RelationshipsModule } from '../relationships/relationships.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Call.name, schema: CallSchema }]),
        forwardRef(() => UsersModule),
        forwardRef(() => ConversationsModule),
        forwardRef(() => RelationshipsModule),
    ],
    providers: [CallService],
    exports: [CallService],
})
export class CallsModule {}
