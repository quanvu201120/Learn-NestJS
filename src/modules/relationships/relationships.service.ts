import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { Subject } from 'rxjs';
import { CreateRelationshipDto } from './dto/create-relationship.dto';
import { RelationshipBlockService } from './relationship-block.service';
import { RelationshipQueryService } from './relationship-query.service';
import { RelationshipRequestService } from './relationship-request.service';
import { RelationshipStatusEnum } from './types/relationship';

@Injectable()
export class RelationshipsService {
    public readonly relationshipCreated$ = new Subject<{
        recipientId: string;
    }>();

    public readonly relationshipAccepted$ = new Subject<{
        userIds: string[];
    }>();

    public readonly relationshipDeleted$ = new Subject<{
        targetUserId: string;
    }>();

    public readonly relationshipBlocked$ = new Subject<{
        targetUserId: string;
        actorId: string;
    }>();

    public readonly relationshipUnblocked$ = new Subject<{
        targetUserId: string;
        actorId: string;
    }>();

    constructor(
        private readonly relationshipQueryService: RelationshipQueryService,
        private readonly relationshipRequestService: RelationshipRequestService,
        private readonly relationshipBlockService: RelationshipBlockService,
    ) {}

    /**
     * Lấy danh sách relationship của user (Bao gồm tất cả các trạng thái của user, để FE tự filter)
     */
    async getRelationshipByUser(userId: string) {
        return this.relationshipQueryService.getRelationshipByUser(userId);
    }

    /**
     * Chấp nhận lời mời kết bạn.
     */
    async accept(relationshipId: string, userId: string, targetUserId: string) {
        const accepted = await this.relationshipRequestService.accept(
            relationshipId,
            userId,
            targetUserId,
        );

        this.relationshipAccepted$.next({
            userIds: [
                accepted.requester.toString(),
                accepted.recipient.toString(),
            ],
        });

        return accepted;
    }

    /**
     * Tạo relationship
     */
    async create(
        createRelationshipDto: CreateRelationshipDto,
        userId: string,
        status: RelationshipStatusEnum = RelationshipStatusEnum.PENDING,
    ) {
        const created = await this.relationshipRequestService.create(
            createRelationshipDto,
            userId,
            status,
        );
        if (created.status === RelationshipStatusEnum.PENDING) {
            this.relationshipCreated$.next({
                recipientId: created.recipient.toString(),
            });
        }

        if (created.status === RelationshipStatusEnum.ACCEPTED) {
            this.relationshipAccepted$.next({
                userIds: [
                    created.requester.toString(),
                    created.recipient.toString(),
                ],
            });
        }

        return created;
    }

    /**
     * Từ chối lời mời kết bạn hoặc xóa lời mời kết bạn đã gửi.
     */
    async rejectOrRemove(
        relationshipId: string,
        userId: string,
        targetUserId: string,
    ) {
        const result = await this.relationshipRequestService.rejectOrRemove(
            relationshipId,
            userId,
            targetUserId,
        );
        this.relationshipDeleted$.next({ targetUserId });

        return result;
    }

    /**
     * Hủy kết bạn.
     */
    async unfriend(
        relationshipId: string,
        userId: string,
        targetUserId: string,
    ) {
        const result = await this.relationshipRequestService.unfriend(
            relationshipId,
            userId,
            targetUserId,
        );

        this.relationshipDeleted$.next({ targetUserId });
        return result;
    }

    /**
     * Chặn một user cụ thể, cho phép chặn người lạ, tránh spam quấy rối
     */
    async blockUser(userId: string, blockId: string, session?: ClientSession) {
        const blocked = await this.relationshipBlockService.blockUser(
            userId,
            blockId,
            session,
        );
        this.relationshipBlocked$.next({
            targetUserId: blockId,
            actorId: userId,
        });

        return blocked;
    }

    /**
     * Bỏ chặn một user cụ thể
     */
    async unblockUser(userId: string, blockId: string) {
        const result = await this.relationshipBlockService.unblockUser(
            userId,
            blockId,
        );

        this.relationshipUnblocked$.next({
            targetUserId: blockId,
            actorId: userId,
        });

        return result;
    }

    /**
     * Kiểm tra xem 2 user có ai đang block ai không.
     */
    async checkIsBlocked(userId1: string, userId2: string) {
        return this.relationshipQueryService.checkIsBlocked(userId1, userId2);
    }

    /**
     * Lấy những user trong danh sách có relationship status BLOCK với user hiện tại.
     */
    async getBlockedUserIdsAmongUsers(
        userId: string,
        targetUserIds: string[],
    ): Promise<string[]> {
        return this.relationshipQueryService.getBlockedUserIdsAmongUsers(
            userId,
            targetUserIds,
        );
    }

    /**
     * Kiểm tra xem 2 user có đang là bạn bè không.
     */
    async checkIsFriend(userId1: string, userId2: string): Promise<boolean> {
        return this.relationshipQueryService.checkIsFriend(userId1, userId2);
    }

    /**
     * Lấy danh sách ID bạn bè (ACCEPTED) từ một mảng targetUserIds đầu vào.
     * Dùng để tối ưu hóa truy vấn thay vì gọi checkIsFriend nhiều lần trong vòng lặp.
     */
    async getFriendIdsAmongUsers(
        userId: string,
        targetUserIds: string[],
    ): Promise<string[]> {
        return this.relationshipQueryService.getFriendIdsAmongUsers(
            userId,
            targetUserIds,
        );
    }
}
