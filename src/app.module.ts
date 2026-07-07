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
    ],
    controllers: [AppController],
    providers: [
        AppService,
        {
            provide: APP_GUARD,
            useClass: JwtAuthGuard,
        },
    ],
})
export class AppModule {}
