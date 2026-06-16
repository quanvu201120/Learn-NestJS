import { Controller } from '@nestjs/common';
import { CleanupJobsService } from './cleanup-jobs.service';

@Controller('cleanup-jobs')
export class CleanupJobsController {
    constructor(private readonly cleanupJobsService: CleanupJobsService) {}
}
