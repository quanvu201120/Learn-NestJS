import { Types } from 'mongoose';
import { Relationship } from '../schemas/relationship.schema';

import { UserResponse } from '@/modules/users/types/user';

export enum RelationshipStatusEnum {
    PENDING = 'PENDING',
    ACCEPTED = 'ACCEPTED',
    BLOCKED = 'BLOCKED',
}

export type RelationshipResponse = Omit<
    Relationship,
    'requester' | 'recipient' | 'blockedBy'
> & {
    _id: Types.ObjectId | string;
    requester: UserResponse | Types.ObjectId | string;
    recipient: UserResponse | Types.ObjectId | string;
    blockedBy?: Types.ObjectId | string;
    createdAt?: Date;
    updatedAt?: Date;
};
