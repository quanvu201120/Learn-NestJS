import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { MessageResponse } from './types/message';

@Injectable()
export class MessageEventService {
    public readonly restoredConversation$ = new Subject<{
        conversationId: string;
        members: string[];
    }>();
    public readonly unseenMessage$ = new Subject<{
        conversationId: string;
        userIds: string[];
    }>();

    public readonly updatedMessage$ = new Subject<MessageResponse>();
    public readonly createdMessage$ = new Subject<MessageResponse>();
    public readonly pinnedMessage$ = new Subject<{
        conversationId: string;
        messageId: string;
    }>();
    public readonly unpinnedMessage$ = new Subject<{
        conversationId: string;
        messageId: string;
    }>();
}
