/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { CloudinaryService } from './providers/cloudinary.service';
import { R2Service } from './providers/r2.service';
import { Media, MediaDocument } from './schemas/media.schema';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { MEDIA_MESSAGES } from './constants/media.constant';
import { OwnerTypeEnum } from './types/media';
import { toObjectId } from '@/utils/utils';

@Injectable()
export class MediaService implements OnModuleInit {
    constructor(
        @InjectModel(Media.name) private mediaModel: Model<MediaDocument>,
        private readonly cloudinaryService: CloudinaryService,
        private readonly r2Service: R2Service,
    ) {}

    async onModuleInit() {
        // console.log(
        //     'Cloudinary initialized',
        //     await this.cloudinaryService.ping(),
        // );
    }

    async createMedia(media: Media, session?: ClientSession) {
        const result = await this.mediaModel.create([media], { session });
        const createdMedia = result[0];
        if (!createdMedia) {
            throw new BadRequestException(MEDIA_MESSAGES.MEDIA_CREATE_FAILED);
        }
        return createdMedia;
    }

    async findById(id: string, session?: ClientSession) {
        const objectId = toObjectId(id, 'media id');
        const result = await this.mediaModel.findById(objectId, null, {
            session,
        });
        if (!result) {
            throw new BadRequestException(MEDIA_MESSAGES.MEDIA_NOT_FOUND);
        }
        return result;
    }

    async deleteMedia(id: string, session?: ClientSession) {
        const objectId = toObjectId(id, 'media id');
        const result = await this.mediaModel.findByIdAndDelete(objectId, {
            session,
        });
        return !!result;
    }

    async uploadImageToCloudinary(
        uploadedBy: Types.ObjectId,
        ownerType: OwnerTypeEnum,
        ownerId: Types.ObjectId,
        file: Express.Multer.File,
        folder: string,
    ) {
        return await this.cloudinaryService.uploadImage(
            uploadedBy,
            ownerType,
            ownerId,
            file,
            folder,
        );
    }

    async deleteImageFromCloudinary(publicId: string) {
        return await this.cloudinaryService.deleteResource(publicId);
    }
}
