/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { RelationshipResponse } from '../types/relationship';
import { serializeUser } from '@/modules/users/utils/user.serializer';

/**
 * Chuyển document relationship thô thành response shape mà client sử dụng.
 */
export const serializeRelationship = (
    relationship: any,
): RelationshipResponse => {
    const { requester, recipient, blockedBy, ...rest } = relationship;

    return {
        ...(rest.toJSON ? rest.toJSON() : rest),
        _id: rest._id ? rest._id.toString() : undefined,
        requester: serializeUser(requester),
        recipient: serializeUser(recipient),
        blockedBy: blockedBy ? blockedBy.toString() : undefined,
    };
};
