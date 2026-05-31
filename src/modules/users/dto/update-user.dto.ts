import {
    IsEmail,
    IsMongoId,
    IsNotEmpty,
    IsOptional,
    IsString,
} from 'class-validator';

export class UpdateUserDto {
    @IsMongoId({ message: 'Id must be a mongoId' })
    @IsNotEmpty({ message: 'Id is required' })
    _id: string;

    @IsOptional()
    @IsNotEmpty({ message: 'Name is not empty' })
    name?: string;

    @IsOptional()
    @IsEmail({}, { message: 'Email must be a valid email' })
    email?: string;

    @IsOptional()
    @IsNotEmpty({ message: 'Phone is not empty' })
    phone?: string;

    @IsOptional()
    @IsNotEmpty({ message: 'Address is not empty' })
    address?: string;

    @IsOptional()
    @IsNotEmpty({ message: 'Avatar is not empty' })
    image?: string;
}
