import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { UnprocessableEntityException, ValidationPipe } from '@nestjs/common';
import { TransformInterceptor } from './common/transform.interceptor';
import cookieParser from 'cookie-parser';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    const configService = app.get(ConfigService);
    const port = configService.get<number>('PORT');
    app.setGlobalPrefix('api/v1', { exclude: [''] });
    app.enableCors();
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            exceptionFactory: (validationErrors = []) => {
                const errors = {};
                validationErrors.forEach((err) => {
                    const constraints = err.constraints;
                    if (constraints) {
                        errors[err.property] = Object.values(constraints)[0];
                    }
                });
                return new UnprocessableEntityException({
                    statusCode: 422,
                    error: 'Unprocessable Entity',
                    message: 'Validation failed',
                    errors: errors,
                });
            },
        }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    app.use(cookieParser());
    await app.listen(port!);
}
bootstrap();
