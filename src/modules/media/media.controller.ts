/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Controller, Get, Param, Request, Res } from '@nestjs/common';
import { MediaService } from './media.service';
import type { Response } from 'express';

@Controller('media')
export class MediaController {
    constructor(private readonly mediaService: MediaService) {}

    @Get(':id/download')
    async downloadMedia(
        @Param('id') id: string,
        @Request() req,
        @Res() res: Response,
    ) {
        const file = await this.mediaService.downloadR2Media(
            id,
            req.user._id.toString(),
        );

        const encodedFileName = encodeURIComponent(file.fileName);
        res.setHeader('Content-Type', file.mimeType);
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`,
        );
        res.setHeader('Content-Length', file.buffer.length.toString());
        res.send(file.buffer);
    }
}
