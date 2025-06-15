import { Property } from '../../entity';
import { HttpStatus } from '../../http';
import { ExcludeStrict, Newable, OmitStrict } from '../../types';
import { MetadataUtilities } from '../../utilities';
import { DefaultOpenApiResponse, FileOpenApiResponse, OpenApiResponse } from '../open-api.model';
import { PaginationResult } from '../pagination-result.model';

// eslint-disable-next-line typescript/no-namespace
export namespace Response {
    export function object(
        entityClass: Newable<unknown>,
        data?: OmitStrict<DefaultOpenApiResponse, 'isArray' | 'type' | 'cls'>
    ): MethodDecorator {
        return (target, propertyKey) => {
            const ctor: Function = target.constructor;
            // eslint-disable-next-line unicorn/error-message
            const stack: string = new Error().stack ?? '';
            MetadataUtilities.setFilePath(ctor, stack);

            const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(ctor, propertyKey.toString());
            responses.push({
                ...data,
                type: 'default',
                isArray: false,
                cls: entityClass
            });
            MetadataUtilities.setRouteResponses(ctor, responses, propertyKey.toString());

        };
    }

    export function array(
        entityClass: Newable<unknown>,
        data?: OmitStrict<DefaultOpenApiResponse, 'isArray' | 'type' | 'cls'>
    ): MethodDecorator {
        return (target, propertyKey) => {
            const ctor: Function = target.constructor;
            // eslint-disable-next-line unicorn/error-message
            const stack: string = new Error().stack ?? '';
            MetadataUtilities.setFilePath(ctor, stack);

            const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(ctor, propertyKey.toString());
            responses.push({
                ...data,
                isArray: true,
                type: 'default',
                cls: entityClass
            });
            MetadataUtilities.setRouteResponses(ctor, responses, propertyKey.toString());
        };
    }

    export function paginated(
        entityClass: Newable<unknown>,
        data?: OmitStrict<DefaultOpenApiResponse, 'isArray' | 'type' | 'cls'>
    ): MethodDecorator {
        return (target, propertyKey) => {
            const ctor: Function = target.constructor;
            // eslint-disable-next-line unicorn/error-message
            const stack: string = new Error().stack ?? '';
            MetadataUtilities.setFilePath(ctor, stack);

            const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(ctor, propertyKey.toString());
            class Temp implements PaginationResult<typeof entityClass> {
                @Property.array({ items: { type: 'object', cls: () => entityClass }, description: 'the paginated items' })
                items!: (typeof entityClass)[];

                @Property.number({ description: 'the total amount of items' })
                totalAmount!: number;
            }
            responses.push({
                description: `response of paginated ${entityClass.name} entities`,
                status: HttpStatus.OK,
                ...data,
                isArray: false,
                cls: Temp,
                type: 'default'
            });
            MetadataUtilities.setRouteResponses(ctor, responses, propertyKey.toString());
        };
    }

    export function empty(
        status: HttpStatus = HttpStatus.OK,
        data?: OmitStrict<DefaultOpenApiResponse, 'isArray' | 'type' | 'status' | 'cls'>
    ): MethodDecorator {
        return (target, propertyKey) => {
            const ctor: Function = target.constructor;
            // eslint-disable-next-line unicorn/error-message
            const stack: string = new Error().stack ?? '';
            MetadataUtilities.setFilePath(ctor, stack);

            const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(ctor, propertyKey.toString());
            responses.push({
                ...data,
                cls: undefined,
                isArray: undefined,
                type: 'default',
                status
            });
            MetadataUtilities.setRouteResponses(ctor, responses, propertyKey.toString());
        };
    }

    export function file(data?: OmitStrict<FileOpenApiResponse, 'type'>): MethodDecorator {
        return (target, propertyKey) => {
            const ctor: Function = target.constructor;
            // eslint-disable-next-line unicorn/error-message
            const stack: string = new Error().stack ?? '';
            MetadataUtilities.setFilePath(ctor, stack);

            const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(ctor, propertyKey.toString());
            responses.push({
                ...data,
                type: 'file'
            });
            MetadataUtilities.setRouteResponses(ctor, responses, propertyKey.toString());
        };
    }

    export function error(
        status: ExcludeStrict<HttpStatus, HttpStatus.OK | HttpStatus.CREATED>,
        data?: OmitStrict<DefaultOpenApiResponse, 'isArray' | 'type' | 'status' | 'cls'>
    ): MethodDecorator {
        return (target, propertyKey) => {
            const ctor: Function = target.constructor;
            // eslint-disable-next-line unicorn/error-message
            const stack: string = new Error().stack ?? '';
            MetadataUtilities.setFilePath(ctor, stack);

            const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(ctor, propertyKey.toString());
            responses.push({
                ...data,
                type: 'default',
                cls: undefined,
                isArray: undefined,
                status
            });
            MetadataUtilities.setRouteResponses(ctor, responses, propertyKey.toString());
        };
    }
}