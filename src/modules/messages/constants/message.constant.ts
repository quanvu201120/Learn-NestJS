export const MESSAGE_MESSAGES = {
    MESSAGE_NOT_FOUND: 'Không tìm thấy tin nhắn',
    REPLY_NOT_FOUND: 'Không tìm thấy tin nhắn reply',
    REPLY_DELETED: 'Tin nhắn reply đã bị xóa',
    MESSAGE_CONTENT_REQUIRED: 'Vui lòng nhập nội dung tin nhắn',
    MESSAGE_NOT_CREATED: 'Tạo tin nhắn thất bại',
    CONVERSATION_NO_MESSAGES: 'Cuộc trò chuyện chưa có tin nhắn nào',
    CANNOT_DELETE_USER_HIDDEN: 'Người dùng đã ẩn cuộc trò chuyện trước đó',
    NOT_BELONG_TO_CONVERSATION: 'Tin nhắn không thuộc cuộc trò chuyện này',
    NOT_MESSAGE_OWNER: 'Tin nhắn không thuộc về người dùng này',
    ALREADY_DELETED: 'Tin nhắn đã bị xóa',
    DELETE_SUCCESS: 'Xóa tin nhắn thành công',
    MESSAGE_NOT_UPDATED: 'Cập nhật tin nhắn thất bại',
    FILE_REQUIRED: 'Vui lòng tải lên tệp',
    PIN_MESSAGE_NOT_PINNED: 'Tin nhắn này chưa được ghim',
    CANNOT_SEND_MESSAGE_TO_BLOCKED_USER:
        'Không thể gửi tin nhắn cho người đã chặn bạn',
    USER_MUTED: (time: string) => `Bạn đã bị cấm chat đến ${time}`,
} as const;
