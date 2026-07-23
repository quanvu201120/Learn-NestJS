/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatExpireTime, logCatch } from '@/utils/utils';
import * as fs from 'fs';
import * as path from 'path';
import handlebars from 'handlebars';

@Injectable()
export class UserMailService {
    private readonly logger = new Logger(UserMailService.name);

    constructor(private readonly configService: ConfigService) {}

    /**
     * Gửi email chứa mã OTP để kích hoạt tài khoản.
     */
    async sendEmailActive(email: string, code: string) {
        const rawExpire = this.configService.get<string>(
            'MAIL_CODE_ACTIVE_EXPIRE',
        )!;
        const expireTime = formatExpireTime(rawExpire);

        return await this.sendEmailViaResend(
            email,
            'Welcome!',
            this.configService.get<string>('MAIL_REGISTER_TEMPLATE') ||
                'register',
            {
                email: email,
                activationCode: code,
                expireTime: expireTime,
            },
        );
    }

    /**
     * Hàm helper: Render template HTML (Handlebars) và gửi email qua Resend HTTP API.
     */
    async sendEmailViaResend(
        to: string,
        subject: string,
        templateName: string,
        context: any,
    ) {
        try {
            const templatePath = path.join(
                __dirname,
                '..',
                '..',
                'mail',
                'template',
                `${templateName}.hbs`,
            );
            const templateSource = fs.readFileSync(templatePath, 'utf-8');
            const compiledTemplate = handlebars.compile(templateSource);
            const htmlContent = compiledTemplate(context);

            const resendApiKey =
                this.configService.get<string>('RESEND_API_KEY');
            const mailFrom =
                this.configService.get<string>('MAIL_FROM') ||
                'onboarding@resend.dev';

            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${resendApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from: mailFrom,
                    to,
                    subject,
                    html: htmlContent,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                this.logger.error(
                    `Resend API error details: ${JSON.stringify(errorData)}`,
                );
                throw new Error(
                    `Resend API failed with status ${response.status}`,
                );
            }

            return await response.json();
        } catch (error) {
            logCatch(this.logger, 'Failed to send email via Resend', error);
            throw error;
        }
    }
}
