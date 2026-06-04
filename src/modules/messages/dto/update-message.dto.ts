import {
    IsEnum,
    IsMongoId,
    IsNotEmpty,
    IsOptional,
    IsString,
} from 'class-validator';
import { MessageEnumType } from '../schemas/message.schema';

export class UpdateMessageDto {
    @IsEnum(MessageEnumType)
    type: MessageEnumType;

    @IsString()
    @IsNotEmpty()
    content: string;
}
