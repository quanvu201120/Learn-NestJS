import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ReportReasonEnum, ReportStatusEnum } from '../types/report.type';

export type ReportDocument = HydratedDocument<Report>;

@Schema({ _id: false })
export class ReportSnapshot {
    @Prop({ type: Types.ObjectId, ref: 'Media' })
    avatarMediaId?: Types.ObjectId;

    @Prop()
    displayName?: string;

    @Prop()
    bio?: string;

    @Prop()
    role?: string;
}

@Schema({ timestamps: true })
export class Report {
    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    reporterId: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    targetUserId: Types.ObjectId;

    @Prop({
        type: String,
        enum: Object.values(ReportReasonEnum),
        required: true,
    })
    reason: ReportReasonEnum;

    @Prop()
    description?: string;

    @Prop({ type: [{ type: Types.ObjectId, ref: 'Media' }] })
    evidenceMediaIds?: Types.ObjectId[];

    @Prop({ type: ReportSnapshot })
    snapshot?: ReportSnapshot;

    @Prop({
        type: String,
        enum: Object.values(ReportStatusEnum),
        default: ReportStatusEnum.PENDING,
    })
    status: ReportStatusEnum;

    @Prop({ type: Types.ObjectId, ref: 'User' })
    resolvedBy?: Types.ObjectId;

    @Prop()
    resolvedAt?: Date;

    @Prop()
    appealDeadline?: Date;

    @Prop()
    appealText?: string;

    @Prop({ type: [{ type: Types.ObjectId, ref: 'Media' }] })
    appealEvidenceMediaIds?: Types.ObjectId[];

    @Prop()
    adminNote?: string;

    @Prop()
    penaltyApplied?: string;
}

export const ReportSchema = SchemaFactory.createForClass(Report);

ReportSchema.index({ targetUserId: 1, status: 1 });
ReportSchema.index({ reporterId: 1 });
ReportSchema.index({ createdAt: 1 });
