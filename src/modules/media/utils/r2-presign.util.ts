import { createHash, createHmac } from 'crypto';
import { MEDIA_CONSTANTS } from '../constants/media.constant';

/**
 * Ký presigned URL (AWS SigV4, query-string) cho object trên Cloudflare R2.
 *
 * R2 tương thích S3 nên dùng đúng thuật toán SigV4 với service 's3', region 'auto'.
 * Cố ý tự ký bằng `crypto` thay vì `@aws-sdk/s3-request-presigner` để giữ hàm này
 * ĐỒNG BỘ — serializer media (và cả chuỗi serializeMessage/serializeUser gọi nó)
 * đều là hàm thuần sync, không thể chuyển sang async mà không lan ra toàn hệ thống.
 *
 * URL trả về hết hạn sau `SIGNED_URL_TTL_SECONDS`; sau đó client phải xin URL mới
 * qua endpoint `/media/:id/url`. Bucket R2 phải để chế độ private thì TTL mới có ý nghĩa.
 */

const AMZ_ALGORITHM = 'AWS4-HMAC-SHA256';
const AWS_REGION = 'auto';
const AWS_SERVICE = 's3';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

/**
 * Encode theo chuẩn RFC 3986 mà SigV4 yêu cầu (khắt khe hơn encodeURIComponent:
 * còn phải encode ! ' ( ) * ). Nếu `encodeSlash = false` thì giữ nguyên '/'
 * để dùng cho canonical URI của object key nhiều tầng thư mục.
 */
const rfc3986Encode = (value: string, encodeSlash = true): string => {
    return value
        .split('')
        .map((char) => {
            if (/[A-Za-z0-9\-_.~]/.test(char)) {
                return char;
            }
            if (char === '/' && !encodeSlash) {
                return char;
            }
            return `%${char
                .charCodeAt(0)
                .toString(16)
                .toUpperCase()
                .padStart(2, '0')}`;
        })
        .join('');
};

const hmac = (key: Buffer | string, data: string): Buffer =>
    createHmac('sha256', key).update(data, 'utf8').digest();

const sha256Hex = (data: string): string =>
    createHash('sha256').update(data, 'utf8').digest('hex');

/**
 * `20250722T101530Z` và `20250722` từ một thời điểm — định dạng SigV4 cần.
 */
const formatAmzDate = (date: Date) => {
    const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    return { amzDate: iso, dateStamp: iso.slice(0, 8) };
};

/**
 * Sinh presigned GET URL cho một `objectKey` trên R2.
 * Trả về `undefined` nếu thiếu cấu hình (để caller fallback an toàn).
 */
export const buildR2SignedUrl = (
    objectKey: string,
    ttlSeconds: number = MEDIA_CONSTANTS.SIGNED_URL_TTL_SECONDS,
): string | undefined => {
    if (!objectKey) {
        return undefined;
    }

    const endpoint = process.env.R2_ENDPOINT?.replace(/\/$/, '');
    const bucket = process.env.R2_BUCKET_NAME;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
        return undefined;
    }

    let host: string;
    try {
        host = new URL(endpoint).host;
    } catch {
        return undefined;
    }

    const { amzDate, dateStamp } = formatAmzDate(new Date());
    const credentialScope = `${dateStamp}/${AWS_REGION}/${AWS_SERVICE}/aws4_request`;

    // Path-style: /<bucket>/<objectKey>; encode từng ký tự nhưng giữ '/'.
    const canonicalUri = `/${rfc3986Encode(bucket, false)}/${rfc3986Encode(
        objectKey,
        false,
    )}`;

    const queryParams: Record<string, string> = {
        'X-Amz-Algorithm': AMZ_ALGORITHM,
        'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
        'X-Amz-Date': amzDate,
        'X-Amz-Expires': String(ttlSeconds),
        'X-Amz-SignedHeaders': 'host',
    };

    const canonicalQueryString = Object.keys(queryParams)
        .sort()
        .map(
            (key) => `${rfc3986Encode(key)}=${rfc3986Encode(queryParams[key])}`,
        )
        .join('&');

    const canonicalHeaders = `host:${host}\n`;
    const canonicalRequest = [
        'GET',
        canonicalUri,
        canonicalQueryString,
        canonicalHeaders,
        'host',
        UNSIGNED_PAYLOAD,
    ].join('\n');

    const stringToSign = [
        AMZ_ALGORITHM,
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = hmac(
        hmac(
            hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), AWS_REGION),
            AWS_SERVICE,
        ),
        'aws4_request',
    );
    const signature = createHmac('sha256', signingKey)
        .update(stringToSign, 'utf8')
        .digest('hex');

    return `${endpoint}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
};
