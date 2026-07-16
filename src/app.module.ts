import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { UsersModule } from '@/modules/users/users.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '@/auth/auth.module';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/passport/jwt-auth.guard';
import { RedisModule } from './redis/redis.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { MessagesModule } from './modules/messages/messages.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { PresenceModule } from './modules/presence/presence.module';
import { MediaModule } from './modules/media/media.module';
import { RelationshipsModule } from './modules/relationships/relationships.module';
import { ScheduleModule } from '@nestjs/schedule';
import { StatsModule } from './modules/stats/stats.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { ReportsModule } from './modules/reports/reports.module';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { THROTTLE_LIMITS } from './auth/constants/auth.constant';
import { ThrottlerUserIpGuard } from './common/throttler-user-ip.guard';

@Module({
    imports: [
        UsersModule,
        AuthModule,
        RedisModule,
        ConversationsModule,
        MessagesModule,
        RealtimeModule,
        PresenceModule,
        MediaModule,
        AuditLogModule,
        ReportsModule,
        NotificationsModule,
        ThrottlerModule.forRoot({
            throttlers: [
                {
                    ttl: THROTTLE_LIMITS.ONE_MINUTE,
                    limit: THROTTLE_LIMITS.GLOBAL_LIMIT,
                    blockDuration: THROTTLE_LIMITS.ONE_MINUTE,
                },
            ],
            errorMessage: (_context, detail) => {
                const seconds = Math.max(
                    detail.timeToBlockExpire || detail.timeToExpire || 1,
                    1,
                );
                return `Bạn thao tác quá nhanh, vui lòng thử lại sau ${seconds} giây.`;
            },
        }),
        ConfigModule.forRoot({ isGlobal: true }),
        EventEmitterModule.forRoot(),
        RelationshipsModule,
        StatsModule,
        MongooseModule.forRootAsync({
            imports: [ConfigModule],
            // eslint-disable-next-line @typescript-eslint/require-await
            useFactory: async (configService: ConfigService) => ({
                uri: configService.get<string>('MONGODB_URI'),
            }),
            inject: [ConfigService],
        }),
        ServeStaticModule.forRoot({
            rootPath: join(__dirname, '..', 'client'),
            exclude: ['/api/(.*)'],
        }),
        ScheduleModule.forRoot(),
        BullModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                connection: {
                    host: configService.get<string>('REDIS_HOST'),
                    port: Number(configService.get<string>('REDIS_PORT')),
                    password: configService.get<string>('REDIS_PASSWORD'),
                },
            }),
        }),
    ],
    controllers: [AppController],
    providers: [
        AppService,
        {
            provide: APP_GUARD,
            useClass: JwtAuthGuard,
        },
        {
            provide: APP_GUARD,
            useClass: ThrottlerUserIpGuard,
        },
    ],
})
export class AppModule {}
