import { SystemDailyStat } from '../schemas/system-daily-stat.schema';

export type ChartDataResponse = SystemDailyStat & {
    redisAvgMemoryBytes: number;
    redisAvgClients: number;
};
