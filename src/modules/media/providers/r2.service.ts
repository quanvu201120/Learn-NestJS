import { Injectable } from '@nestjs/common';
import { CreateMediaDto } from '../dto/create-media.dto';
import { Media } from '../schemas/media.schema';

@Injectable()
export class R2Service {
    createUploadTarget(_payload: CreateMediaDto): Promise<Media> {
        throw new Error('Not implemented');
    }

    deleteObject(_objectKey: string): Promise<void> {
        throw new Error('Not implemented');
    }
}
