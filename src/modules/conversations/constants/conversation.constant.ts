export const CONVERSATION_MESSAGES = {
    DIRECT_MUST_BE_2_USERS: 'Direct conversation must have exactly 2 users',
    GROUP_NAME_REQUIRED: 'Group name is required',
    GROUP_MIN_3_USERS:
        'Group conversation must have at least 3 users including creator',
    USERS_NOT_EXIST: 'One or more users do not exist',
    USER_NOT_FOUND: 'User not found',
    NAME_REQUIRED: 'Name is required',
    CANNOT_REMOVE_ADMIN: 'Cannot remove admin of this group',
    NOT_A_MEMBER: 'User is not a member of conversation',
    ALREADY_HIDDEN: 'Conversation already hidden for this user',
    DELETE_SUCCESS: 'Delete conversation successfully',
    DELETE_FAILED: 'Cannot delete conversation',
    CANNOT_READ_OLDER: 'Cannot mark as read to an older message',
    MESSAGE_NOT_FOUND: 'Message not found',
    CONVERSATION_NOT_FOUND: 'Conversation not found',
    DIRECT_ACTION_NOT_ALLOWED:
        'Cannot perform this action on direct conversation',
    NOT_GROUP_ADMIN: 'You are not admin of this group',
    USER_NOT_IN_CONVERSATION: 'User is not in conversation',
    MEMBER_REQUIRED: 'Member remove is required',
} as const;
