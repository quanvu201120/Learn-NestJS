import {
    IsMongoId,
    IsArray,
    IsString,
    MaxLength,
    MinLength,
    ArrayMinSize,
} from 'class-validator';

export class UpdateNameConversationDto {
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    name: string;
}
export class AddMembersConversationDto {
    @IsArray()
    @ArrayMinSize(1)
    @IsMongoId({ each: true })
    members: string[];
}
export class RemoveMemberConversationDto {
    @IsMongoId()
    memberId: string;
}
