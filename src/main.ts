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
                    message: 'Validation failed',
                    errors: formatErrors(validationErrors),
                });
            },
        }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    app.use(cookieParser());

    // CONFIG SWAGGER
    const config = new DocumentBuilder()
        .setTitle('NestJS Learn API')
        .setDescription('API documentation for NestJS Learn application')
        .setVersion('1.0')
        .addBearerAuth(
            {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                name: 'JWT',
                description: 'Enter JWT token',
                in: 'header',
            },
            'JWT-auth', // This name must match the one used in security decorators
        )
        .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('swagger', app, document);

    await app.listen(port!);
}
bootstrap();
