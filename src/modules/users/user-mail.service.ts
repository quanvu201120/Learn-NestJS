import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatExpireTime } from '@/utils/utils';
import * as fs from 'fs';
import * as path from 'path';
import handlebars from 'handlebars';

@Injectable()
export class UserMailService {
    constructor(private readonly configService: ConfigService) {}

    /**
     * Gá»­i email chá»©a mÃ£ OTP Ä‘á»ƒ kÃ­ch hoáº¡t tÃ i khoáº£n.
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
     * HÃ m helper: Render template HTML (Handlebars) vÃ  gá»­i email qua Resend HTTP API.
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
                console.error('âŒ Resend API Error Details:', errorData);
                throw new Error(
                    `Resend API failed with status ${response.status}`,
                );
            }

            return await response.json();
        } catch (error) {
            console.error('âŒ Failed to send email via Resend:', error);
            throw error;
        }
    }
}
