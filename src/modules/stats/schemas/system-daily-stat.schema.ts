import { HydratedDocument } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export type SystemDailyStatDocument = HydratedDocument<SystemDailyStat>;

/**
 * Schema thống kê hệ thống theo từng ngày.
 * Lưu lại số lượng user mới, group mới, direct message mới, lượng tin nhắn các loại
 * và dung lượng upload media trong 1 ngày cụ thể.
 */
@Schema({ timestamps: true })
export class SystemDailyStat {
    /**
     * Ngày thống kê dưới định dạng `YYYY-MM-DD`.
     * Cột này được set `unique: true` để mỗi ngày chỉ có duy nhất 1 bản ghi.
     */
    @Prop({ type: String, required: true, unique: true })
    date: string;

    /** Số tài khoản đăng ký mới trong ngày. */
    @Prop({ type: Number, default: 0 })
    newUsers: number;

    /** Số lượt đăng nhập (sinh JWT mới) thành công trong ngày. */
    @Prop({ type: Number, default: 0 })
    logins: number;

    /** Số lượng nhóm chat (Group) mới được tạo trong ngày. */
    @Prop({ type: Number, default: 0 })
    newGroups: number;

    /** Số lượng cuộc trò chuyện 1-1 (Direct) mới được tạo lần đầu trong ngày. */
    @Prop({ type: Number, default: 0 })
    newDirects: number;

    /** Tổng số tin nhắn văn bản (TEXT) gửi đi trong ngày. */
    @Prop({ type: Number, default: 0 })
    messagesText: number;

    /** Tổng số tin nhắn hình ảnh (IMAGE) gửi đi trong ngày. */
    @Prop({ type: Number, default: 0 })
    messagesImage: number;

    /** Tổng số tin nhắn video (VIDEO) gửi đi trong ngày. */
    @Prop({ type: Number, default: 0 })
    messagesVideo: number;

    /** Tổng số tin nhắn tệp tin (FILE) gửi đi trong ngày. */
    @Prop({ type: Number, default: 0 })
    messagesFile: number;

    /** Tổng số tin nhắn ghi âm (VOICE) gửi đi trong ngày. */
    @Prop({ type: Number, default: 0 })
    messagesVoice: number;

    /** Tổng dung lượng upload (tính bằng Bytes) lưu trữ trên Cloudinary (ảnh) trong ngày. */
    @Prop({ type: Number, default: 0 })
    uploadBytesCloudinary: number;

    /** Tổng dung lượng upload (tính bằng Bytes) lưu trữ trên Cloudflare R2 (tệp, video, audio) trong ngày. */
    @Prop({ type: Number, default: 0 })
    uploadBytesR2: number;

    /** Mức sử dụng RAM (Bytes) cao nhất của Redis ghi nhận được trong ngày. */
    @Prop({ type: Number, default: 0 })
    redisPeakMemoryBytes: number;

    /** Lượng kết nối Client cao nhất của Redis ghi nhận được trong ngày. */
    @Prop({ type: Number, default: 0 })
    redisPeakClients: number;

    /** Số lượng người dùng online cùng lúc (CCU) cao nhất ghi nhận được trong ngày. */
    @Prop({ type: Number, default: 0 })
    peakOnlineUsers: number;

    /** Băng thông (Bandwidth) đã sử dụng trên Cloudinary tính bằng Bytes trong ngày. */
    @Prop({ type: Number, default: 0 })
    cloudinaryBandwidthBytes: number;

    /** Dung lượng lưu trữ (Storage) cao nhất ghi nhận được trên Cloudinary tính bằng Bytes trong ngày. */
    @Prop({ type: Number, default: 0 })
    cloudinaryStorageBytes: number;

    /** Băng thông (Bandwidth) đã sử dụng trên Cloudflare R2 tính bằng Bytes trong ngày. */
    @Prop({ type: Number, default: 0 })
    r2BandwidthBytes: number;

    /** Dung lượng lưu trữ (Storage) cao nhất ghi nhận được trên R2 tính bằng Bytes trong ngày. */
    @Prop({ type: Number, default: 0 })
    r2StorageBytes: number;

    /** (Dữ liệu hỗ trợ) Tổng Băng thông tính đến cuối ngày hiện tại của tháng trên Cloudinary. */
    @Prop({ type: Number, default: 0 })
    cloudinaryCumulativeMonthlyBandwidthBytes: number;

    /** (Dữ liệu hỗ trợ) Tổng Băng thông tính đến cuối ngày hiện tại của tháng trên R2. */
    @Prop({ type: Number, default: 0 })
    r2CumulativeMonthlyBandwidthBytes: number;

    /** Số điểm (Credit) đã sử dụng trên Cloudinary tính đến thời điểm hiện tại của tháng. */
    @Prop({ type: Number, default: 0 })
    cloudinaryCreditsUsage: number;

    /** Dung lượng lưu trữ (Storage) cao nhất ghi nhận được trên MongoDB tính bằng Bytes trong ngày. */
    @Prop({ type: Number, default: 0 })
    mongoStorageBytes: number;
}

export const SystemDailyStatSchema =
    SchemaFactory.createForClass(SystemDailyStat);
