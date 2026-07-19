import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { SessionModule } from '../session/session.module';
import {
    PushSubscription,
    PushSubscriptionSchema,
} from './schemas/push-subscription.schema';
import { PushSubscriptionsController } from './push-subscriptions.controller';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { UsersModule } from '../users/users.module';

@Module({
    imports: [
        ConfigModule,
        SessionModule,
        UsersModule,
        MongooseModule.forFeature([
            {
                name: PushSubscription.name,
                schema: PushSubscriptionSchema,
            },
        ]),
    ],
    controllers: [PushSubscriptionsController],
    providers: [PushSubscriptionsService],
    exports: [PushSubscriptionsService],
})
export class PushSubscriptionsModule {}
