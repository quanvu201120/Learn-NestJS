import { HydratedDocument, Types } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
    MediaProviderEnum,
    MediaResourceTypeEnum,
    OwnerTypeEnum,
} from '../types/media';

export type MediaDocument = HydratedDocument<Media>;

@Schema()
export class Media {
    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    uploadedBy: Types.ObjectId;

    @Prop({
        type: String,
        enum: OwnerTypeEnum,
        required: true,
    })
    ownerType: OwnerTypeEnum;

    @Prop({ type: Types.ObjectId, refPath: 'ownerType', required: true })
    ownerId: Types.ObjectId;

    @Prop({
        type: String,
        enum: MediaProviderEnum,
        required: true,
    })
    provider: MediaProviderEnum;

    @Prop({
        type: String,
        enum: MediaResourceTypeEnum,
        required: true,
    })
    resourceType: MediaResourceTypeEnum;

    @Prop({ type: String })
    url?: string;

    @Prop({ type: String })
    publicId?: string;

    @Prop({ type: String })
    objectKey?: string;

    @Prop({ type: String })
    fileName?: string;

    @Prop({ type: String })
    mimeType?: string;

    @Prop({ type: Number })
    size?: number;

    @Prop({ type: Number })
    width?: number;

    @Prop({ type: Number })
    height?: number;

    @Prop({ type: Number })
    duration?: number;

    @Prop({ type: String })
    thumbUrl?: string;
}

export const MediaSchema = SchemaFactory.createForClass(Media);
