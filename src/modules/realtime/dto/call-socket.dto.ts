import { CallEndReasonEnum, CallTypeEnum } from '@/modules/calls/types/call';
import { Type } from 'class-transformer';
import {
    IsEnum,
    IsMongoId,
    IsOptional,
    IsString,
    ValidateNested,
} from 'class-validator';

export class StartCallSocketDto {
    /** ID của người nhận cuộc gọi. */
    @IsMongoId()
    calleeId: string;

    /** ID của conversation chứa cuộc gọi. */
    @IsMongoId()
    conversationId: string;

    /** Loại cuộc gọi: audio hoặc video. */
    @IsEnum(CallTypeEnum)
    callType: CallTypeEnum;
}

export class CallIdSocketDto {
    /** ID của cuộc gọi đang được thao tác. */
    @IsMongoId()
    callId: string;
}

export class CallHeartbeatSocketDto extends CallIdSocketDto {}

export class EndCallSocketDto extends CallIdSocketDto {
    /** Lý do kết thúc cuộc gọi. */
    @IsEnum(CallEndReasonEnum)
    endReason: CallEndReasonEnum;
}

export class SessionDescriptionSocketDto {
    /** Kiểu mô tả phiên WebRTC. */
    @IsString()
    type: 'offer' | 'answer';

    /** Chuỗi SDP của offer/answer. */
    @IsString()
    sdp: string;
}

export class IceCandidateSocketDto {
    /** Candidate string của WebRTC. */
    @IsString()
    candidate: string;

    /** M-line index của candidate, nếu có. */
    @IsOptional()
    @Type(() => Number)
    sdpMLineIndex?: number | null;

    /** SDP mid của candidate, nếu có. */
    @IsOptional()
    @IsString()
    sdpMid?: string | null;

    /** Username fragment của candidate, nếu có. */
    @IsOptional()
    @IsString()
    usernameFragment?: string | null;
}

export class CallOfferSocketDto extends CallIdSocketDto {
    /** ID của conversation để định tuyến signaling. */
    @IsMongoId()
    conversationId: string;

    /** Token ngắn hạn cho signaling cuộc gọi. */
    @IsString()
    callToken: string;

    /** Dữ liệu offer WebRTC. */
    @ValidateNested()
    @Type(() => SessionDescriptionSocketDto)
    offer: SessionDescriptionSocketDto;
}

export class CallAnswerSocketDto extends CallIdSocketDto {
    /** ID của conversation để định tuyến signaling. */
    @IsMongoId()
    conversationId: string;

    /** Token ngắn hạn cho signaling cuộc gọi. */
    @IsString()
    callToken: string;

    /** Dữ liệu answer WebRTC. */
    @ValidateNested()
    @Type(() => SessionDescriptionSocketDto)
    answer: SessionDescriptionSocketDto;
}

export class CallIceCandidateSocketDto extends CallIdSocketDto {
    /** ID của conversation để định tuyến signaling. */
    @IsMongoId()
    conversationId: string;

    /** Token ngắn hạn cho signaling cuộc gọi. */
    @IsString()
    callToken: string;

    /** ICE candidate WebRTC. */
    @ValidateNested()
    @Type(() => IceCandidateSocketDto)
    candidate: IceCandidateSocketDto;
}
