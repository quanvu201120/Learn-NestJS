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
    providers: [UsersService],
    exports: [UsersService],
})
export class UsersModule {}
