import { IsMongoId, IsNotEmpty } from 'class-validator';

export class DeleteUserDto {
    @IsMongoId({ message: 'Id must be a mongoId' })
    @IsNotEmpty({ message: 'Id is required' })
    id: string;
}
