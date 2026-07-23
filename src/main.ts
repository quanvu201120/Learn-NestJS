/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
    UnprocessableEntityException,
    ValidationError,
    ValidationPipe,
} from '@nestjs/common';
import { TransformInterceptor } from './common/transform.interceptor';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { VALIDATION_MESSAGES } from './common/constants/validation.constant';
import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { join, extname } from 'path';

class ConfiguredIoAdapter extends IoAdapter {
    constructor(
        app: INestApplication,
        private readonly corsOrigins: string[],
    ) {
        super(app);
    }

    createIOServer(port: number, options?: ServerOptions): any {
        return super.createIOServer(port, {
            ...options,
            cors: { origin: this.corsOrigins },
        });
    }
}

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    const configService = app.get(ConfigService);
    const port = configService.get<number>('PORT');
    const corsOrigins = (configService.get<string>('CORS_ORIGINS') || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    const isProduction = configService.get<string>('NODE_ENV') === 'production';

    // Media R2 phục vụ qua presigned URL trên chính R2_ENDPOINT (private bucket),
    // nên CSP phải cho phép origin của endpoint này
    const r2EndpointOrigin = (() => {
        const raw = configService.get<string>('R2_ENDPOINT');
        if (!raw) {
            return undefined;
        }
        try {
            return new URL(raw).origin;
        } catch {
            return undefined;
        }
    })();
    const r2CspSources = r2EndpointOrigin ? [r2EndpointOrigin] : [];

    app.setGlobalPrefix('api/v1');
    app.useWebSocketAdapter(new ConfiguredIoAdapter(app, corsOrigins));
    app.enableCors({
        origin: (origin, callback) => {
            if (!origin) {
                callback(null, true);
                return;
            }

            if (corsOrigins.includes(origin)) {
                callback(null, true);
                return;
            }

            callback(new Error('Not allowed by CORS'));
        },
        credentials: true,
    });
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            exceptionFactory: (validationErrors = []) => {
                const formatErrors = (errorsList: ValidationError[]) => {
                    const errors: Record<string, any> = {};
                    errorsList.forEach((err) => {
                        const constraints = err.constraints;
                        if (constraints) {
                            errors[err.property] =
                                Object.values(constraints)[0];
                        } else if (err.children && err.children.length > 0) {
                            errors[err.property] = formatErrors(err.children);
                        }
                    });
                    return errors;
                };

                return new UnprocessableEntityException({
                    statusCode: 422,
                    error: 'Unprocessable Entity',
                    message: VALIDATION_MESSAGES.VALIDATION_FAILED,
                    errors: formatErrors(validationErrors),
                });
            },
        }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    app.use(cookieParser());
    app.use(
        helmet({
            contentSecurityPolicy: {
                useDefaults: true,
                directives: {
                    imgSrc: [
                        "'self'",
                        'data:',
                        'blob:',
                        'https://res.cloudinary.com',
                        'https://*.cloudinary.com',
                        ...r2CspSources,
                    ],
                    // Video/voice R2 phát qua thẻ <video>/<audio>.
                    mediaSrc: ["'self'", 'blob:', ...r2CspSources],
                    // Tải file R2 (presigned) bằng fetch/XHR từ client.
                    connectSrc: ["'self'", ...r2CspSources],
                },
            },
        }),
    );
    //xử lí bổ sung cho client FE khi deplpy chung huggingface
    app.use((req, res, next) => {
        if (req.method !== 'GET') {
            next();
            return;
        }

        const url = req.originalUrl || req.url || '';
        const pathname = url.split('?')[0];
        if (
            pathname.startsWith('/api/') ||
            pathname.startsWith('/swagger') ||
            pathname.startsWith('/assets/') ||
            extname(pathname)
        ) {
            next();
            return;
        }

        res.sendFile(join(process.cwd(), 'client', 'index.html'));
    });

    if (!isProduction) {
        // CONFIG SWAGGER
        const config = new DocumentBuilder()
            .setTitle('NestJS Chat API')
            .setDescription(
                'REST API cho xác thực người dùng, OTP Redis, quản lý session và hệ thống Realtime Chat (Conversations & Messages).',
            )
            .setVersion('1.1.0')
            .setContact('Quanvu201120', 'https://github.com/quanvu201120', '')
            .addBearerAuth(
                {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    name: 'Authorization',
                    description: 'Nhập Access Token dạng: Bearer <token>',
                    in: 'header',
                },
                'JWT-auth',
            )
            .build();
        const document = SwaggerModule.createDocument(app, config);
        SwaggerModule.setup('swagger', app, document, {
            swaggerOptions: {
                persistAuthorization: true,
                docExpansion: 'none',
                tagsSorter: 'alpha',
                operationsSorter: 'alpha',
            },
            customSiteTitle: 'Learn NestJS API Docs',
        });
    }

    await app.listen(port!, '0.0.0.0');
}
bootstrap();
