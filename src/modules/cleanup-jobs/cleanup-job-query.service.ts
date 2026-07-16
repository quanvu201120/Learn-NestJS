/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
    CLEANUP_JOB_CONSTANTS,
    CLEANUP_JOB_MESSAGES,
} from './constants/cleanup-job.constant';
import { CleanupJob, CleanupJobDocument } from './schemas/cleanup-job.schema';
import { CleanupJobRespone, CleanupJobStatusEnum } from './types/cleanup-job';
import { toObjectId } from '@/utils/utils';

@Injectable()
export class CleanupJobQueryService {
    constructor(
        @InjectModel(CleanupJob.name)
        private readonly cleanupJobModel: Model<CleanupJobDocument>,
    ) {}

    /** Lấy tất cả job dọn rác, có pagination và sort desc theo creation date */
    async getCleanUpJobs(
        page: number = CLEANUP_JOB_CONSTANTS.DEFAULT_PAGE,
        limit: number = CLEANUP_JOB_CONSTANTS.DEFAULT_LIMIT,
        type?: string,
        status?: string,
        sort?: string,
    ): Promise<CleanupJobRespone> {
        if (page <= 0 || limit <= 0) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.GET_CLEANUP_JOBS_PAGINATION_INVALID,
            );
        }

        const filter: any = {};
        if (status && status !== 'all') {
            filter.status = status;
        }
        if (type && type !== 'all') {
            if (type === 'cloud')
                filter.action = { $regex: '^CLOUDINARY', $options: 'i' };
            else if (type === 'r2')
                filter.action = { $regex: '^R2', $options: 'i' };
            else if (type === 'redis')
                filter.action = { $regex: '^REDIS', $options: 'i' };
            else if (type === 'session')
                filter.action = { $regex: '^SESSION', $options: 'i' };
        }

        let sortObj: any = { createdAt: -1, _id: -1 };
        let isAggregate = false;
        let aggregatePipeline: any[] = [];

        if (sort === 'created_asc') {
            sortObj = { createdAt: 1, _id: 1 };
        } else if (sort === 'created_desc') {
            sortObj = { createdAt: -1, _id: -1 };
        } else if (sort === 'retry_asc') {
            isAggregate = true;
            aggregatePipeline = [
                { $match: filter },
                {
                    $addFields: {
                        effectiveExecutionTime: {
                            $switch: {
                                branches: [
                                    {
                                        case: {
                                            $eq: [
                                                '$status',
                                                CleanupJobStatusEnum.PENDING,
                                            ],
                                        },
                                        then: '$createdAt',
                                    },
                                    {
                                        case: {
                                            $eq: [
                                                '$status',
                                                CleanupJobStatusEnum.RETRY,
                                            ],
                                        },
                                        then: '$nextRetryAt',
                                    },
                                ],
                                default: null,
                            },
                        },
                    },
                },
                {
                    $addFields: {
                        hasExecutionTime: {
                            $cond: ['$effectiveExecutionTime', 1, 0],
                        },
                    },
                },
                {
                    $sort: {
                        hasExecutionTime: -1,
                        effectiveExecutionTime: 1,
                        _id: 1,
                    },
                },
                { $skip: (page - 1) * limit },
                { $limit: limit },
            ];
        } else if (sort === 'retry_desc') {
            isAggregate = true;
            aggregatePipeline = [
                { $match: filter },
                {
                    $addFields: {
                        effectiveExecutionTime: {
                            $switch: {
                                branches: [
                                    {
                                        case: {
                                            $eq: [
                                                '$status',
                                                CleanupJobStatusEnum.PENDING,
                                            ],
                                        },
                                        then: '$createdAt',
                                    },
                                    {
                                        case: {
                                            $eq: [
                                                '$status',
                                                CleanupJobStatusEnum.RETRY,
                                            ],
                                        },
                                        then: '$nextRetryAt',
                                    },
                                ],
                                default: null,
                            },
                        },
                    },
                },
                {
                    $addFields: {
                        hasExecutionTime: {
                            $cond: ['$effectiveExecutionTime', 1, 0],
                        },
                    },
                },
                {
                    $sort: {
                        hasExecutionTime: -1,
                        effectiveExecutionTime: -1,
                        _id: -1,
                    },
                },
                { $skip: (page - 1) * limit },
                { $limit: limit },
            ];
        }

        const [totalItems, foundJobs] = await Promise.all([
            this.cleanupJobModel.countDocuments(filter),
            isAggregate
                ? this.cleanupJobModel.aggregate(aggregatePipeline)
                : this.cleanupJobModel
                      .find(filter)
                      .skip((page - 1) * limit)
                      .limit(limit)
                      .sort(sortObj),
        ]);
        const totalPages = Math.ceil(totalItems / limit);
        return {
            cleanupJobs: foundJobs,
            pagination: {
                totalItems,
                totalPages,
                currentPage: page,
                limit,
            },
        };
    }

    /** Lấy job dọn rác theo id */
    async getCleanupJobById(jobId: string) {
        const objectId = toObjectId(jobId, 'cleanup job id');
        const cleanupJob = await this.cleanupJobModel
            .findById(objectId)
            .select('-__v')
            .lean();
        if (!cleanupJob) {
            throw new NotFoundException(CLEANUP_JOB_MESSAGES.JOB_NOT_FOUND);
        }
        return cleanupJob as CleanupJob;
    }
}
