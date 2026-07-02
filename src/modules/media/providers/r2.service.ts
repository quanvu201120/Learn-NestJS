import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    GetObjectCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
    PutObjectCommand,
    HeadBucketCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

@Injectable()
export class R2Service {
    private readonly client: S3Client;
    private readonly bucketName: string;

    constructor(private readonly configService: ConfigService) {
        const endpoint = this.configService.get<string>('R2_ENDPOINT');
        const accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID');
        const secretAccessKey = this.configService.get<string>(
            'R2_SECRET_ACCESS_KEY',
        );

        if (!endpoint || !accessKeyId || !secretAccessKey) {
            throw new Error('R2 configuration is missing');
        }

        this.bucketName =
            this.configService.get<string>('R2_BUCKET_NAME') ?? '';

        if (!this.bucketName) {
            throw new Error('R2_BUCKET_NAME is missing');
        }

        this.client = new S3Client({
            region: 'auto',
            endpoint,
            credentials: {
                accessKeyId,
                secretAccessKey,
            },
        });
    }

    /**
     * Ping kết nối với R2 Bucket (Health Check).
     */
    async ping(): Promise<boolean> {
        try {
            // Sử dụng một command nhẹ nhất để xem S3 client cấu hình đúng chưa
            // Thay vì ListObjectsV2 tốn kém, gọi phương thức nào nhẹ cũng được.
            // Có thể bị chặn CORS/Permissions nếu không đủ quyền HeadBucket.
            // Nếu có lỗi do phân quyền, nó sẽ throw Error.
            await this.client.send(
                new HeadBucketCommand({ Bucket: this.bucketName }),
            );
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Upload buffer của một file lên R2 và trả về metadata cần để lưu MongoDB.
     */
    async uploadObject(file: Express.Multer.File, folder: string) {
        const fileName = this.sanitizeFileName(file.originalname);
        const objectKey = `${folder}/${randomUUID()}-${fileName}`;

        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucketName,
                Key: objectKey,
                Body: file.buffer,
                ContentType: file.mimetype,
                ContentLength: file.size,
            }),
        );

        return {
            objectKey,
            fileName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
        };
    }

    /**
     * Xóa một object trên R2.
     */
    async deleteObject(objectKey: string): Promise<void> {
        await this.client.send(
            new DeleteObjectCommand({
                Bucket: this.bucketName,
                Key: objectKey,
            }),
        );
    }

    /**
     * Xóa nhiều object trên R2 sau khi loại bỏ key rỗng và key trùng.
     */
    async deleteObjects(objectKeys: string[]): Promise<void> {
        const uniqueObjectKeys = [...new Set(objectKeys.filter(Boolean))];

        if (uniqueObjectKeys.length === 0) {
            return;
        }

        await this.client.send(
            new DeleteObjectsCommand({
                Bucket: this.bucketName,
                Delete: {
                    Objects: uniqueObjectKeys.map((objectKey) => ({
                        Key: objectKey,
                    })),
                    Quiet: true,
                },
            }),
        );
    }

    async getObject(objectKey: string) {
        return await this.client.send(
            new GetObjectCommand({
                Bucket: this.bucketName,
                Key: objectKey,
            }),
        );
    }

    /**
     * Chuẩn hóa phần tên file trước khi ghép vào `objectKey`.
     */
    private sanitizeFileName(fileName: string) {
        return fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
    }
}
