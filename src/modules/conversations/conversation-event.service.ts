import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

@Injectable()
export class ConversationEventService {
    public readonly conversationDisbanded$ = new Subject<{
        conversationId: string;
        memberIds: string[];
    }>();

    public readonly conversationGroupCreated$ = new Subject<{
        conversationId: string;
        memberIds: string[];
    }>();

    public readonly memberAdded$ = new Subject<{
        conversationId: string;
        addedMemberIds: string[];
        adderId: string;
    }>();

    public readonly memberRemoved$ = new Subject<{
        conversationId: string;
        removedMemberId: string;
        removerId: string;
    }>();

    public readonly conversationNameChanged$ = new Subject<{
        conversationId: string;
        name: string;
    }>();

    public readonly conversationAdminChanged$ = new Subject<{
        conversationId: string;
        newAdminId: string;
        membersOnline: string[];
    }>();
}
