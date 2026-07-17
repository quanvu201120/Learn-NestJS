import { IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateSessionDto {
    @IsNotEmpty()
    @IsMongoId()
    userId: string;

    @IsOptional()
    @IsString()
    refreshTokenHash?: string;

    @IsOptional()
    expiresAt?: Date;

    @IsOptional()
    @IsString()
    userAgent?: string;

    @IsOptional()
    @IsString()
    deviceName?: string;

    @IsNotEmpty()
    @IsString()
    deviceId: string;
}
