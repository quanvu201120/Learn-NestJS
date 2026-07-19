import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, IsUrl, ValidateNested } from 'class-validator';

export class PushSubscriptionKeysDto {
    @IsString()
    @IsNotEmpty()
    p256dh: string;

    @IsString()
    @IsNotEmpty()
    auth: string;
}

export class BrowserPushSubscriptionDto {
    @IsUrl({ require_tld: false })
    endpoint: string;

    @ValidateNested()
    @Type(() => PushSubscriptionKeysDto)
    keys: PushSubscriptionKeysDto;
}

export class UpsertPushSubscriptionDto {
    @IsString()
    @IsNotEmpty()
    deviceId: string;

    @ValidateNested()
    @Type(() => BrowserPushSubscriptionDto)
    subscription: BrowserPushSubscriptionDto;
}
