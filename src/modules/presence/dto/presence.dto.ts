import { ArrayMinSize, IsArray, IsMongoId } from 'class-validator';

export class GetUserOnlineBodyDto {
    @IsMongoId({ each: true })
    @IsArray()
    @ArrayMinSize(1)
    userIds: string[];
}
