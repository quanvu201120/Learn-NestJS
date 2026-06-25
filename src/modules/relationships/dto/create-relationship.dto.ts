import { IsMongoId, IsNotEmpty } from 'class-validator';

export class CreateRelationshipDto {
    @IsNotEmpty()
    @IsMongoId()
    recipient: string;
}
