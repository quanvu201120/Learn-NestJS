import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { CloudinaryService } from './providers/cloudinary.service';
import { R2Service } from './providers/r2.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Media, MediaSchema } from './schemas/media.schema';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Media.name, schema: MediaSchema }]),
    ],
    providers: [MediaService, CloudinaryService, R2Service],
    exports: [MediaService, CloudinaryService, R2Service],
})
export class MediaModule {}
