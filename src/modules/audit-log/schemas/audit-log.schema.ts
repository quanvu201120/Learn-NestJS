import { UserRole } from '@/modules/users/types/user';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument, Types } from 'mongoose';
import {
    AuditLogActionEnum,
    AuditLogTargetEnum,
} from '../types/audit-log.type';
import { ReportStatusEnum } from '@/modules/reports/types/report.type';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({ _id: false })
export class AuditLogMetadata {
    @Prop({ type: Types.ObjectId, ref: 'Media' })
    oldAvatar?: Types.ObjectId;

    @Prop()
    oldName?: string;

    @Prop()
    oldBio?: string;

    @Prop({ type: String, enum: UserRole })
    oldRole?: UserRole;

    @Prop({ type: String, enum: UserRole })
    newRole?: UserRole;

    @Prop()
    reason?: string; // Kept for backward compatibility with older logs

    @Prop({ type: String, enum: ReportStatusEnum })
    rp_status?: ReportStatusEnum;

    @Prop()
    rp_penaltyApplied?: string;

    @Prop()
    rp_adminNote?: string;

    @Prop({ type: Types.ObjectId, ref: 'User' })
    rp_reporterId?: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'User' })
    rp_targetUserId?: Types.ObjectId;

    @Prop()
    rp_description?: string;

    @Prop()
    rp_reason?: string;
}

@Schema({ timestamps: true })
export class AuditLog {
    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    actorId: Types.ObjectId;

    @Prop({ type: String, enum: UserRole, required: true })
    actorRole: UserRole;

    @Prop({ type: String, enum: AuditLogActionEnum, required: true })
    action: string;

    @Prop({ type: Types.ObjectId, refPath: 'targetType', required: true })
    targetId: Types.ObjectId;

    @Prop({ type: String, enum: AuditLogTargetEnum, required: true })
    targetType: string;

    @Prop({ type: AuditLogMetadata, required: true })
    metadata: AuditLogMetadata;

    @Prop({ required: true })
    ip: string;

    @Prop({ required: true })
    userAgent: string;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ createdAt: -1 });
