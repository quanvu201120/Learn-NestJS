import { PenaltyActionEnum } from '../types/report.type';

export const MUTE_1_DAY = 1;
export const MUTE_7_DAYS = 7;
export const MUTE_30_DAYS = 30;
export const BAN_1_DAY = 1;
export const BAN_7_DAYS = 7;
export const BAN_30_DAYS = 30;
export const BAN_PERMANENT_DAYS = 36500;
export const RATE_LIMIT_VIOLATION_TTL_SECONDS = 5 * 60;
export const RATE_LIMIT_BAN_LOCK_TTL_SECONDS = 60;
export const RATE_LIMIT_BAN_THRESHOLD = 3;
export const RATE_LIMIT_BAN_DAYS = BAN_1_DAY;

export const PENALTY_RULES = {
    spam_harassment: [
        { strike: 1, action: PenaltyActionEnum.MUTE, durationDays: MUTE_1_DAY },
        {
            strike: 2,
            action: PenaltyActionEnum.MUTE,
            durationDays: MUTE_7_DAYS,
        },
        {
            strike: 3,
            action: PenaltyActionEnum.MUTE,
            durationDays: MUTE_30_DAYS,
        },
        {
            strike: 4,
            action: PenaltyActionEnum.BAN,
            durationDays: BAN_PERMANENT_DAYS,
        },
    ],
    inappropriate_content: [
        {
            strike: 1,
            action: PenaltyActionEnum.RESET_AND_WARNING,
            durationDays: 0,
        },
        {
            strike: 2,
            action: PenaltyActionEnum.RESET_AND_BAN,
            durationDays: BAN_7_DAYS,
        },
        {
            strike: 3,
            action: PenaltyActionEnum.RESET_AND_BAN,
            durationDays: BAN_30_DAYS,
        },
        {
            strike: 4,
            action: PenaltyActionEnum.RESET_AND_BAN,
            durationDays: BAN_PERMANENT_DAYS,
        },
    ],
    impersonation: [
        {
            strike: 1,
            action: PenaltyActionEnum.RESET_AND_BAN,
            durationDays: BAN_PERMANENT_DAYS,
        },
    ],
    system_spam: [],
    other: [],
};
