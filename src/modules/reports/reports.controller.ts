/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    UseGuards,
    Request,
    Query,
} from '@nestjs/common';
import { CreateReportDto } from './dto/create-report.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { RolesGuard } from '@/auth/passport/roles.guard';
import { Roles } from '@/utils/decorator-customize';
import { UserRole } from '@/modules/users/types/user';
import { GetReportsDto } from './dto/get-reports.dto';
import { ManualBanDto } from './dto/manual-ban.dto';
import {
    AdminActionReasonDto,
    AdminActionWithPasswordDto,
} from '@/modules/users/dto/update-user.dto';
import { QuickPenaltyDto } from './dto/quick-penalty.dto';
import { ReportsService } from './reports.service';
import { ReportReasonEnum } from './types/report.type';

@Controller('reports')
export class ReportsController {
    constructor(private readonly reportsService: ReportsService) {}

    @Post()
    async create(@Body() createReportDto: CreateReportDto, @Request() req) {
        return await this.reportsService.create(createReportDto, req.user._id);
    }

    @Get()
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    @UseGuards(RolesGuard)
    async findAll(@Query() query: GetReportsDto) {
        return await this.reportsService.findAll(query);
    }

    @Get(':id')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    @UseGuards(RolesGuard)
    async findOne(@Param('id') id: string) {
        return await this.reportsService.findOne(id);
    }

    @Patch(':id/resolve')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    @UseGuards(RolesGuard)
    async resolve(
        @Param('id') id: string,
        @Body() resolveDto: ResolveReportDto,
        @Request() req,
    ) {
        return await this.reportsService.resolve(
            id,
            resolveDto,
            req.user._id,
            req.user.role,
            req,
        );
    }

    @Post('quick-penalty/:targetUserId')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    @UseGuards(RolesGuard)
    async quickPenalty(
        @Param('targetUserId') targetUserId: string,
        @Body() body: QuickPenaltyDto,
        @Request() req,
    ) {
        return await this.reportsService.quickPenalty(
            targetUserId,
            req.user._id,
            req.user.role,
            body,
            req,
        );
    }

    @Post('manual-ban/:targetUserId')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    @UseGuards(RolesGuard)
    async manualBan(
        @Param('targetUserId') targetUserId: string,
        @Body() body: ManualBanDto,
        @Request() req,
    ) {
        return await this.reportsService.manualBan(
            targetUserId,
            req.user._id,
            req.user.role,
            body,
            req,
        );
    }

    @Patch(':targetUserId/unban')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    @UseGuards(RolesGuard)
    async unban(
        @Param('targetUserId') targetUserId: string,
        @Body() body: AdminActionWithPasswordDto,
        @Request() req,
    ) {
        return await this.reportsService.unban(
            targetUserId,
            req.user._id,
            req.user.role,
            body,
            req,
        );
    }

    @Patch(':targetUserId/unmute')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    @UseGuards(RolesGuard)
    async unmute(
        @Param('targetUserId') targetUserId: string,
        @Body() body: AdminActionWithPasswordDto,
        @Request() req,
    ) {
        return await this.reportsService.unmute(
            targetUserId,
            req.user._id,
            req.user.role,
            body,
            req,
        );
    }

    @Patch(':targetUserId/clear-strike')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    @UseGuards(RolesGuard)
    async clearStrike(
        @Param('targetUserId') targetUserId: string,
        @Body() body: AdminActionWithPasswordDto,
        @Request() req,
    ) {
        return await this.reportsService.clearStrike(
            targetUserId,
            req.user._id,
            req.user.role,
            body,
            req,
        );
    }
}
