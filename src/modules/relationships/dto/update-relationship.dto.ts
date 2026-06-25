import { IsNotEmpty, IsString } from 'class-validator';

export class TargetUserRelationshipDto {
    @IsString()
    @IsNotEmpty()
    targetUserId: string;
}
