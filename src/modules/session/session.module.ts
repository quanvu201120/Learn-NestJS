import { Module } from '@nestjs/common';
import { SessionService } from './session.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Session, SessionSchema } from './schemas/session.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Session.name, schema: SessionSchema },
        ]),
    ],
    controllers: [],
    providers: [SessionService],
    exports: [SessionService],
})
export class SessionModule {}
