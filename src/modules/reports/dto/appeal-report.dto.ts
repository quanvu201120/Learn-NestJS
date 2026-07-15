import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AppealReportDto {
    @IsNotEmpty()
    @IsString()
    @MaxLength(500)
    appealText: string;
}
