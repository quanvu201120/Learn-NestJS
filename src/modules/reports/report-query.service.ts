/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';
import { toObjectId, validateObjectId } from '@/utils/utils';
import { REPORT_MESSAGES } from './constants/report.constant';
import { GetReportsDto } from './dto/get-reports.dto';
import { Report, ReportDocument } from './schemas/report.schema';
import { PenaltyTypeEnum, ReportStatusEnum } from './types/report.type';

@Injectable()
export class ReportQueryService {
    constructor(
        @InjectModel(Report.name)
        private readonly reportModel: Model<ReportDocument>,
    ) {}

    /**
     * Tìm report đại diện cho án ban đang chặn đăng nhập của user.
     *
     * Method này chỉ phục vụ flow login bị ban, nên chỉ xét report đang áp dụng hình phạt khóa tài khoản.
     */
    async findCurrentAppealContextByUserId(userId: string) {
        const objectUserId = toObjectId(userId, 'userId');
        const report = await this.reportModel
            .findOne({
                targetUserId: objectUserId,
                penaltyType: PenaltyTypeEnum.BAN,
                status: {
                    $in: [
                        ReportStatusEnum.APPEAL_PENDING,
                        ReportStatusEnum.APPEAL_REJECTED,
                        ReportStatusEnum.RESOLVED,
                    ],
                },
            })
            .sort({ updatedAt: -1, resolvedAt: -1, createdAt: -1 })
            .select(
                '_id reason status appealDeadline appealReviewDeadline penaltyApplied penaltyType',
            )
            .lean();

        if (!report) {
            return null;
        }

        return {
            reportId: report._id.toString(),
            reason: report.reason,
            status: report.status,
            appealDeadline: report.appealDeadline,
            appealReviewDeadline: report.appealReviewDeadline,
            penaltyApplied: report.penaltyApplied,
            penaltyType: report.penaltyType,
        };
    }

    /**
     * Lấy danh sách report cho trang quản trị, có phân trang, lọc theo field,
     * lọc ngày tạo, tìm theo reportId và sắp xếp mới nhất/cũ nhất.
     */
    async findAll(query: GetReportsDto) {
        const {
            current = 1,
            pageSize = GLOBAL_CONSTANTS.LIMIT_REPORTS_DEFAULT,
            startDate,
            endDate,
            reportId,
            sort,
            ...filters
        } = query;
        const page = Math.max(Number(current) || 1, 1);
        const limit = Math.min(
            Math.max(
                Number(pageSize) || GLOBAL_CONSTANTS.LIMIT_REPORTS_DEFAULT,
                1,
            ),
            GLOBAL_CONSTANTS.LIMIT_REPORTS_MAX,
        );
        const skip = (page - 1) * limit;

        const filterQuery: any = { ...filters };

        if (filterQuery.targetRole) {
            filterQuery['snapshot.role'] = filterQuery.targetRole;
            delete filterQuery.targetRole;
        }

        if (startDate || endDate) {
            filterQuery.createdAt = {};
            if (startDate) filterQuery.createdAt.$gte = new Date(startDate);
            if (endDate) filterQuery.createdAt.$lte = new Date(endDate);
        }

        if (reportId) {
            filterQuery._id = reportId;
        }

        const sortQuery: any = {};
        if (sort === 'oldest') {
            sortQuery.createdAt = 1;
        } else {
            sortQuery.createdAt = -1;
        }

        const totalItems = await this.reportModel.countDocuments(filterQuery);
        const totalPages = Math.ceil(totalItems / limit);

        const reports = await this.reportModel
            .find(filterQuery)
            .sort(sortQuery)
            .skip(skip)
            .limit(limit)
            .populate({
                path: 'reporterId',
                select: 'name email avatar bio role',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate({
                path: 'targetUserId',
                select: 'name email avatar bio role',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate('resolvedBy', 'name email')
            .populate('evidenceMediaIds', '-__v')
            .populate('appealEvidenceMediaIds', '-__v')
            .populate('snapshot.avatarMediaId', '-__v')
            .lean();

        return { totalPages, totalItems, reports };
    }

    /**
     * Tìm report theo id cho các API nội bộ cần tự xử lý lỗi hoặc validate status.
     */
    async findByIdForApi(id: string) {
        return await this.reportModel.findById(id);
    }

    /**
     * Tìm chi tiết một report cho trang quản trị, kèm thông tin reporter,
     * target user, admin xử lý, media bằng chứng và avatar snapshot.
     */
    async findOne(id: string) {
        validateObjectId(id, 'reportId');
        const report = await this.reportModel
            .findById(id)
            .populate({
                path: 'reporterId',
                select: 'name email avatar bio role',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate({
                path: 'targetUserId',
                select: 'name email avatar bio role',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate('resolvedBy', 'name email')
            .populate('evidenceMediaIds', '-__v')
            .populate('appealEvidenceMediaIds', '-__v')
            .populate('snapshot.avatarMediaId', '-__v')
            .lean();

        if (!report) {
            throw new BadRequestException(REPORT_MESSAGES.REPORT_NOT_FOUND);
        }
        return report;
    }
}
