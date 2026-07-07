import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { GetAuditLogsDto } from './dto/get-audit-logs.dto';
import { RolesGuard } from '@/auth/passport/roles.guard';
import { Roles } from '@/utils/decorator-customize';
import { UserRole } from '@/modules/users/types/user';

@Controller('audit-logs')
@Roles(UserRole.SUPER_ADMIN)
@UseGuards(RolesGuard)
export class AuditLogController {
    constructor(private readonly auditLogService: AuditLogService) {}

    @Get()
    async findAll(@Query() query: GetAuditLogsDto) {
        return this.auditLogService.findAll(query);
    }
}
