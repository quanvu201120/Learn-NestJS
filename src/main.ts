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
import { join, extname } from 'path';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    const configService = app.get(ConfigService);
    const port = configService.get<number>('PORT');
    const corsOrigins = (configService.get<string>('CORS_ORIGINS') || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    const isProduction = configService.get<string>('NODE_ENV') === 'production';
    const r2PublicBaseUrl = configService
        .get<string>('R2_PUBLIC_BASE_URL')
        ?.replace(/\/$/, '');

    app.setGlobalPrefix('api/v1');
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
                        ...(r2PublicBaseUrl ? [r2PublicBaseUrl] : []),
                    ],
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
