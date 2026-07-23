/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { StringValue } from 'ms';
import { AUTH_MESSAGES } from '@/auth/constants/auth.constant';
import { REPORT_MESSAGES } from './constants/report.constant';
import { AppealReportDto } from './dto/appeal-report.dto';
import { Report, ReportDocument } from './schemas/report.schema';
import { ReportStatusEnum } from './types/report.type';
import { validateObjectId } from '@/utils/utils';
import { NotificationTypeEnum } from '../notifications/types/notification.type';
import { NOTIFICATION_TITLES } from '../notifications/constants/notification.constant';
import { ReportMediaService } from './report-media.service';

@Injectable()
export class ReportAppealService {
    constructor(
        @InjectModel(Report.name)
        private readonly reportModel: Model<ReportDocument>,
        private readonly reportMediaService: ReportMediaService,
        private readonly eventEmitter: EventEmitter2,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
    ) {}

    /**
     * Sinh JWT ngắn hạn chỉ dùng cho flow kháng cáo một report cụ thể.
     *
     * Token này không thay thế access token của app và chỉ hợp lệ với scope
     * `report_appeal`.
     */
    async generateAppealToken(userId: string, reportId: string) {
        return await this.jwtService.signAsync(
            {
                sub: userId,
                reportId,
                scope: 'report_appeal',
            },
            {
                secret: this.configService.get<string>('APPEAL_TOKEN_SECRET'),
                expiresIn: this.configService.get<string>(
                    'APPEAL_TOKEN_EXPIRES_IN',
                ) as StringValue,
            },
        );
    }

    /**
     * Xác thực appeal token lấy từ header Authorization.
     *
     * Token phải đúng định dạng bearer token, đúng scope và gắn với report
     * đang được kháng cáo.
     */
    private async verifyAppealToken(
        authorization: string | undefined,
        reportId: string,
    ) {
        if (!authorization?.startsWith('Bearer ')) {
            throw new UnauthorizedException(AUTH_MESSAGES.APPEAL_TOKEN_INVALID);
        }

        const token = authorization.slice(7).trim();
        const payload = await this.jwtService.verifyAsync(token, {
            secret: this.configService.get<string>('APPEAL_TOKEN_SECRET'),
        });

        if (
            !payload ||
            payload.scope !== 'report_appeal' ||
            payload.reportId !== reportId
        ) {
            throw new UnauthorizedException(AUTH_MESSAGES.APPEAL_TOKEN_INVALID);
        }

        return {
            userId: payload.sub as string,
            reportId: payload.reportId as string,
        };
    }

    /**
     * Nhận đơn kháng cáo bằng appeal token thay vì access token đăng nhập.
     *
     * Flow này cho phép user bị ban vẫn có thể gửi kháng cáo khi FE đã nhận
     * được appeal token từ login response hoặc từ endpoint cấp quyền kháng cáo.
     */
    async appeal(
        id: string,
        authorization: string | undefined,
        appealDto: AppealReportDto,
        files: Express.Multer.File[] = [],
    ) {
        validateObjectId(id, 'reportId');
        const appealIdentity = await this.verifyAppealToken(authorization, id);
        const report = await this.reportModel.findById(id);

        if (!report) {
            throw new BadRequestException(REPORT_MESSAGES.REPORT_NOT_FOUND);
        }

        if (report.targetUserId.toString() !== appealIdentity.userId) {
            throw new ForbiddenException(REPORT_MESSAGES.MISSING_PERMISSION);
        }

        if (report.status !== ReportStatusEnum.RESOLVED) {
            throw new BadRequestException(
                REPORT_MESSAGES.REPORT_INVALID_STATUS,
            );
        }

        if (!report.appealDeadline || report.appealDeadline < new Date()) {
            throw new BadRequestException(
                REPORT_MESSAGES.APPEAL_DEADLINE_EXPIRED,
            );
        }

        const uploadedMediaDocs =
            await this.reportMediaService.uploadEvidenceImages(
                appealIdentity.userId,
                files,
            );

        try {
            report.status = ReportStatusEnum.APPEAL_PENDING;
            report.appealReviewDeadline = new Date(
                Date.now() + 30 * 24 * 60 * 60 * 1000,
            );
            report.appealText = appealDto.appealText.trim();
            report.appealEvidenceMediaIds = uploadedMediaDocs.map(
                (media) => media._id,
            );
            await report.save();
        } catch (error) {
            await this.reportMediaService.rollbackEvidenceImages(
                uploadedMediaDocs,
            );
            throw error;
        }

        this.eventEmitter.emit('notification.create', {
            userId: report.targetUserId.toString(),
            type: NotificationTypeEnum.REPORT_APPEAL_PENDING,
            title: NOTIFICATION_TITLES[
                NotificationTypeEnum.REPORT_APPEAL_PENDING
            ],
            refId: report._id.toString(),
            snapshot: {
                avatarMediaId: report.snapshot?.avatarMediaId,
                displayName: report.snapshot?.displayName,
                bio: report.snapshot?.bio,
                role: report.snapshot?.role,
            },
            metadata: {
                reportStatus: report.status,
                reason: report.reason,
                penaltyApplied: report.penaltyApplied,
                penaltyType: report.penaltyType,
                appealDeadline: report.appealDeadline,
                appealReviewDeadline: report.appealReviewDeadline,
            },
        });

        return {
            message:
                NOTIFICATION_TITLES[NotificationTypeEnum.REPORT_APPEAL_PENDING],
            report,
        };
    }

    /**
     * Cấp appeal token cho user đang ở trong app và đã chọn đúng report muốn
     * kháng cáo từ notification hoặc màn hình chi tiết.
     */
    async getAppealAccess(id: string, userId: string) {
        validateObjectId(id, 'reportId');
        const report = await this.reportModel
            .findById(id)
            .select(
                '_id targetUserId status appealDeadline appealReviewDeadline penaltyApplied penaltyType',
            );

        if (!report) {
            throw new BadRequestException(REPORT_MESSAGES.REPORT_NOT_FOUND);
        }

        if (report.targetUserId.toString() !== userId) {
            throw new ForbiddenException(REPORT_MESSAGES.MISSING_PERMISSION);
        }

        if (
            report.status !== ReportStatusEnum.RESOLVED &&
            report.status !== ReportStatusEnum.APPEAL_PENDING &&
            report.status !== ReportStatusEnum.APPEAL_REJECTED
        ) {
            throw new BadRequestException(
                REPORT_MESSAGES.REPORT_INVALID_STATUS,
            );
        }

        const canAppeal =
            report.status === ReportStatusEnum.RESOLVED &&
            !!report.appealDeadline &&
            report.appealDeadline > new Date();

        return {
            reportId: report._id.toString(),
            status: report.status,
            appealDeadline: report.appealDeadline,
            appealReviewDeadline: report.appealReviewDeadline,
            penaltyApplied: report.penaltyApplied,
            penaltyType: report.penaltyType,
            appealToken: canAppeal
                ? await this.generateAppealToken(userId, report._id.toString())
                : undefined,
        };
    }
}
