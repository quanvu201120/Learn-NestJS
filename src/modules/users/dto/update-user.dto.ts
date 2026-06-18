import { IsEmail, IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateUserDto {
    @IsMongoId({ message: 'Id must be a mongoId' })
    _id: string;

    @IsNotEmpty({ message: 'Name must not be empty' })
    @IsString({ message: 'Name must be a string' })
    name: string;

    @IsOptional()
    @IsEmail({}, { message: 'Email must be a valid email' })
    email?: string;

    @IsOptional()
    @IsString({ message: 'Phone must be a string' })
    phone?: string | null;

    @IsOptional()
    @IsString({ message: 'Address must be a string' })
    address?: string | null;
}
