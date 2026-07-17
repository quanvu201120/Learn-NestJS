import { forwardRef, Module } from '@nestjs/common';
import { SessionService } from './session.service';
import { SessionDeviceService } from './session-device.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Session, SessionSchema } from './schemas/session.schema';
import { CleanupJobsModule } from '../cleanup-jobs/cleanup-jobs.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Session.name, schema: SessionSchema },
        ]),
        forwardRef(() => CleanupJobsModule),
    ],
    controllers: [],
    providers: [SessionService, SessionDeviceService],
    exports: [SessionService, SessionDeviceService],
})
export class SessionModule {}
