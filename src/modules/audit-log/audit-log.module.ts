import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogService } from './audit-log.service';
import { AuditLogController } from './audit-log.controller';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: AuditLog.name, schema: AuditLogSchema },
        ]),
    ],
    controllers: [AuditLogController],
    providers: [AuditLogService],
})
export class AuditLogModule {}
