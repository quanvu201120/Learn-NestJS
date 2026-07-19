import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '@/modules/users/users.module';
import { ConfigService } from '@nestjs/config';
import { StringValue } from 'ms';
import { PassportModule } from '@nestjs/passport';
import { LocalStrategy } from './passport/local.strategy';
import { JwtStrategy } from './passport/jwt.strategy';
import { SessionModule } from '@/modules/session/session.module';
import { StatsModule } from '@/modules/stats/stats.module';
import { ReportsModule } from '@/modules/reports/reports.module';
import { PushSubscriptionsModule } from '@/modules/push-subscriptions/push-subscriptions.module';

@Module({
    imports: [
        UsersModule,
        SessionModule,
        StatsModule,
        ReportsModule,
        PushSubscriptionsModule,
        PassportModule,
        JwtModule.registerAsync({
            global: true,
            useFactory: (configService: ConfigService) => ({
                secret: configService.get<string>('JWT_SECRET'),
                signOptions: {
                    expiresIn:
                        configService.get<StringValue>('JWT_EXPRIRES_IN'),
                },
            }),
            inject: [ConfigService],
        }),
    ],
    controllers: [AuthController],
    providers: [AuthService, LocalStrategy, JwtStrategy],
    exports: [AuthService],
})
export class AuthModule {}
