import { AUTH_MESSAGES } from '@/auth/constants/auth.constant';
import { formatDateTime } from '@/utils/utils';
import {
    BadRequestException,
    Inject,
    Injectable,
    forwardRef,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { RELATIONSHIP_MESSAGES } from './constants/relationship.constant';

@Injectable()
export class RelationshipAccessService {
    constructor(
        @Inject(forwardRef(() => UsersService))
        private readonly usersService: UsersService,
    ) {}

    /**
     * Kiểm tra 2 user có tồn tại và hoạt động bình thường hay không.
     * Nếu requireTargetActive = false, chỉ kiểm tra người thao tác (requesterId),
     * còn target (recipientId) dù bị vô hiệu hóa vẫn cho phép thao tác.
     */
    async checkActiveRequesterAndRecipient(
        requesterId: string,
        recipientId: string,
        requireTargetActive: boolean = true,
    ) {
        if (requesterId === recipientId) {
            throw new BadRequestException(
                RELATIONSHIP_MESSAGES.CANNOT_BE_SAME_USER,
            );
        }
        const [requester, recipient] = await Promise.all([
            this.usersService.findOne(requesterId),
            this.usersService.findOne(recipientId),
        ]);
        if (!requester || !recipient) {
            throw new BadRequestException(RELATIONSHIP_MESSAGES.USER_NOT_FOUND);
        }

        if (!requester.isActive) {
            throw new BadRequestException(
                RELATIONSHIP_MESSAGES.REQUESTER_NOT_ACTIVE,
            );
        }

        if (requester.isDisabled) {
            throw new BadRequestException(
                RELATIONSHIP_MESSAGES.REQUESTER_DISABLED,
            );
        }

        if (requireTargetActive) {
            if (!recipient.isActive) {
                throw new BadRequestException(
                    RELATIONSHIP_MESSAGES.RECIPIENT_NOT_ACTIVE,
                );
            }
            if (recipient.isDisabled) {
                throw new BadRequestException(
                    RELATIONSHIP_MESSAGES.RECIPIENT_DISABLED,
                );
            }
            if (recipient.banUntil && recipient.banUntil > new Date()) {
                const time = formatDateTime(recipient.banUntil);
                throw new BadRequestException(
                    AUTH_MESSAGES.ACCOUNT_BANNED_UNTIL(time),
                );
            }
        }
        return { requester, recipient };
    }
}
