/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
    registerDecorator,
    ValidationOptions,
    ValidationArguments,
} from 'class-validator';
import { SetMetadata } from '@nestjs/common';

export function Match(property: string, validationOptions?: ValidationOptions) {
    return function (object: object, propertyName: string) {
        registerDecorator({
            name: 'Match',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: {
                validate(value: any, args: ValidationArguments) {
                    if (value === undefined || value === null || value === '') {
                        return true; // Để @IsNotEmpty xử lý lỗi bỏ trống
                    }
                    const [relatedPropertyName] = args.constraints;
                    const relatedValue = (args.object as any)[
                        relatedPropertyName
                    ];
                    return value === relatedValue; // So sánh 2 giá trị có bằng nhau không
                },
                defaultMessage(args: ValidationArguments) {
                    const [relatedPropertyName] = args.constraints;
                    return `${args.property} phải trùng khớp với ${relatedPropertyName}`;
                },
            },
        });
    };
}

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: ('USER' | 'ADMIN')[]) =>
    SetMetadata(ROLES_KEY, roles);

import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const Cookies = createParamDecorator(
    (data: string, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return data ? request.cookies?.[data] : request.cookies;
    },
);
