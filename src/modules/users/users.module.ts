import { forwardRef, Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { MediaModule } from '../media/media.module';
import { SessionModule } from '../session/session.module';
import { RelationshipsModule } from '../relationships/relationships.module';
import { StatsModule } from '../stats/stats.module';

import { ReportsModule } from '../reports/reports.module';
import { UserQueryService } from './user-query.service';
import { UserSerializerService } from './user-serializer.service';
import { UserCodeService } from './user-code.service';
import { UserMailService } from './user-mail.service';
import { UserPasswordService } from './user-password.service';
import { UserAuthProfileService } from './user-auth-profile.service';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
        forwardRef(() => MediaModule),
        SessionModule,
        forwardRef(() => RelationshipsModule),
        forwardRef(() => ReportsModule),
        StatsModule,
    ],
    controllers: [UsersController],
    providers: [
        UsersService,
        UserQueryService,
        UserSerializerService,
        UserCodeService,
        UserMailService,
        UserPasswordService,
        UserAuthProfileService,
    ],
    exports: [UsersService],
})
export class UsersModule {}
