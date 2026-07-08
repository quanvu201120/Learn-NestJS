import { PenaltyActionEnum } from '../types/report.type';

export const PENALTY_RULES = {
    spam_harassment: [
        { strike: 1, action: PenaltyActionEnum.MUTE, durationDays: 1 },
        { strike: 2, action: PenaltyActionEnum.MUTE, durationDays: 7 },
        { strike: 3, action: PenaltyActionEnum.MUTE, durationDays: 30 },
        { strike: 4, action: PenaltyActionEnum.BAN, durationDays: 36500 },
    ],
    inappropriate_content: [
        {
            strike: 1,
            action: PenaltyActionEnum.RESET_AND_WARNING,
            durationDays: 0,
        },
        { strike: 2, action: PenaltyActionEnum.RESET_AND_BAN, durationDays: 7 },
        {
            strike: 3,
            action: PenaltyActionEnum.RESET_AND_BAN,
            durationDays: 30,
        },
        {
            strike: 4,
            action: PenaltyActionEnum.RESET_AND_BAN,
            durationDays: 36500,
        },
    ],
    impersonation: [
        {
            strike: 1,
            action: PenaltyActionEnum.RESET_AND_BAN,
            durationDays: 36500,
        },
    ],
    other: [],
};
