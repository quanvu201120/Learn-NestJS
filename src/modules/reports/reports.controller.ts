/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
    BadRequestException,
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    UseGuards,
    Request,
    Query,
    NotFoundException,
    UploadedFiles,
    UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Public } from '@/utils/decorator-customize';
import { CreateReportDto } from './dto/create-report.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { RolesGuard } from '@/auth/passport/roles.guard';
import { Roles } from '@/utils/decorator-customize';
import { UserRole } from '@/modules/users/types/user';
import { GetReportsDto } from './dto/get-reports.dto';
import { ManualBanDto } from './dto/manual-ban.dto';
import { AdminActionWithPasswordDto } from '@/modules/users/dto/update-user.dto';
import { QuickPenaltyDto } from './dto/quick-penalty.dto';
import { AppealReportDto } from './dto/appeal-report.dto';
import { ReportsService } from './reports.service';
import { REPORT_MESSAGES } from './constants/report.constant';
import { ReportStatusEnum } from './types/report.type';
import {
    MEDIA_CONSTANTS,
    MEDIA_MESSAGES,
} from '../media/constants/media.constant';

@Controller('reports')
export class ReportsController {
    constructor(private readonly reportsService: ReportsService) {}

    @Post()
    @UseInterceptors(
        FilesInterceptor('files', 5, {
            limits: {
                fileSize: MEDIA_CONSTANTS.MAX_IMAGE_FILE_SIZE,
            },
            fileFilter: (_req, file, callback) => {
                if (!file.mimetype.startsWith('image/')) {
                    callback(
                        new BadRequestException(MEDIA_MESSAGES.WRONG_FILE_TYPE),
                        false,
                    );
                    return;
                }

                callback(null, true);
            },
        }),
    )
    async create(
        @Body() createReportDto: CreateReportDto,
        @UploadedFiles() files: Express.Multer.File[],
        @Request() req,
    ) {
        return await this.reportsService.create(
            createReportDto,
            req.user._id,
            files || [],
        );
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

    @Get(':id/calculate-penalty')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    @UseGuards(RolesGuard)
    async calculatePenalty(@Param('id') id: string) {
        const report = await this.reportsService.findByIdForApi(id);
        if (!report) {
            throw new NotFoundException(REPORT_MESSAGES.REPORT_NOT_FOUND);
        }
        if (report.status !== ReportStatusEnum.PENDING) {
            throw new BadRequestException(
                REPORT_MESSAGES.REPORT_ALREADY_RESOLVED,
            );
        }

        return await this.reportsService.calculatePenaltyInfo(
            report.targetUserId.toString(),
            report.reason,
        );
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

    @Patch(':id/appeal')
    @Public()
    @UseInterceptors(
        FilesInterceptor('files', 5, {
            limits: {
                fileSize: MEDIA_CONSTANTS.MAX_IMAGE_FILE_SIZE,
            },
            fileFilter: (_req, file, callback) => {
                if (!file.mimetype.startsWith('image/')) {
                    callback(
                        new BadRequestException(MEDIA_MESSAGES.WRONG_FILE_TYPE),
                        false,
                    );
                    return;
                }

                callback(null, true);
            },
        }),
    )
    async appeal(
        @Param('id') id: string,
        @Body() appealDto: AppealReportDto,
        @UploadedFiles() files: Express.Multer.File[],
        @Request() req,
    ) {
        return await this.reportsService.appeal(
            id,
            req.headers.authorization as string | undefined,
            appealDto,
            files || [],
        );
    }

    @Get(':id/appeal-access')
    async getAppealAccess(@Param('id') id: string, @Request() req) {
        return await this.reportsService.getAppealAccess(id, req.user._id);
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
