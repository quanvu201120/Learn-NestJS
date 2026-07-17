export type SessionDeviceResponse = {
    _id: string;
    deviceId: string;
    deviceName?: string;
    userAgent?: string;
    expiresAt?: Date;
    lastUsedAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
};
