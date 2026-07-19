export enum CallTypeEnum {
    AUDIO = 'audio',
    VIDEO = 'video',
}

export enum CallStatusEnum {
    CALLING = 'calling',
    ACCEPTED = 'accepted',
    REJECTED = 'rejected',
    ENDED = 'ended',
    MISSED = 'missed',
}

export enum CallEndReasonEnum {
    USER_HANGUP = 'user_hangup',
    CALLEE_REJECT = 'callee_reject',
    TIMEOUT = 'timeout',
    NETWORK_LOST = 'network_lost',
    ERROR = 'error',
}
