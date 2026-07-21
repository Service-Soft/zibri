
import { HttpStatus } from '../../http/http-status.enum';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { JsonOpenApiResponse, ErrorOpenApiResponse, FileOpenApiResponse, OpenApiResponse, HtmlOpenApiResponse } from '../open-api.model';
import { PaginationResultClass } from '../pagination-result.model';

/**
 * Bundles decorators for http responses.
 */
// eslint-disable-next-line typescript/no-namespace
export namespace Response {

    /**
     * A single object json response.
     * @param entityClass - The class that defines the response objects structure.
     * @param data - Additional configuration, like status or description.
     */
    export function object(
        entityClass: Newable<unknown>,
        data?: OmitStrict<JsonOpenApiResponse, 'isArray' | 'type' | 'cls'>
    ): MethodDecorator {
        return (target, propertyKey) => {
            const ctor: Function = target.constructor;
            // eslint-disable-next-line unicorn/error-message
            const stack: string = new Error().stack ?? '';
            MetadataUtilities.setFilePath(ctor, stack);

            const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(ctor, propertyKey.toString());
            responses.push({
                ...data,
                type: 'json',
                isArray: false,
                cls: entityClass
            });
            MetadataUtilities.setRouteResponses(ctor, responses, propertyKey.toString());

        };
    }

    /**
     * An array json response.
     * @param entityClass - The class that defines the items in the response array.
     * @param data - Additional configuration, like status or description.
     */
    export function array(
        entityClass: Newable<unknown>,
        data?: OmitStrict<JsonOpenApiResponse, 'isArray' | 'type' | 'cls'>
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
                type: 'json',
                cls: entityClass
            });
            MetadataUtilities.setRouteResponses(ctor, responses, propertyKey.toString());
        };
    }

    /**
     * A paginated result json response.
     * @param entityClass - The class that defines the paginated items response structure.
     * @param data - Additional configuration, like status or description.
     */
    export function paginated(
        entityClass: Newable<unknown>,
        data?: OmitStrict<JsonOpenApiResponse, 'isArray' | 'type' | 'cls'>
    ): MethodDecorator {
        return (target, propertyKey) => {
            const ctor: Function = target.constructor;
            // eslint-disable-next-line unicorn/error-message
            const stack: string = new Error().stack ?? '';
            MetadataUtilities.setFilePath(ctor, stack);

            const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(ctor, propertyKey.toString());
            responses.push({
                description: `response of paginated ${entityClass.name} entities`,
                status: HttpStatus.OK,
                ...data,
                isArray: false,
                cls: PaginationResultClass(entityClass),
                type: 'json'
            });
            MetadataUtilities.setRouteResponses(ctor, responses, propertyKey.toString());
        };
    }

    /**
     * An empty response where nothing is returned.
     * @param status - The status of the response, defaults to 200.
     * @param data - Additional configuration, like description.
     */
    export function empty(
        status: HttpStatus = HttpStatus.OK,
        data?: OmitStrict<JsonOpenApiResponse, 'isArray' | 'type' | 'status' | 'cls'>
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
                type: 'json',
                status
            });
            MetadataUtilities.setRouteResponses(ctor, responses, propertyKey.toString());
        };
    }

    /**
     * A response where a file is returned.
     * @param data - Additional data, like mime type or description.
     */
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

    /**
     * A response that returns html.
     * @param data - Additional data, like status or description.
     */
    export function html(data?: OmitStrict<HtmlOpenApiResponse, 'type'>): MethodDecorator {
        return (target, propertyKey) => {
            const ctor: Function = target.constructor;
            // eslint-disable-next-line unicorn/error-message
            const stack: string = new Error().stack ?? '';
            MetadataUtilities.setFilePath(ctor, stack);

            const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(ctor, propertyKey.toString());
            responses.push({
                ...data,
                type: 'html'
            });
            MetadataUtilities.setRouteResponses(ctor, responses, propertyKey.toString());

        };
    }

    /**
     * An error response.
     * @param status - The status of the response.
     * @param data - Additional data like description etc.
     */
    export function error(
        status: ExcludeStrict<HttpStatus, HttpStatus.OK | HttpStatus.CREATED>,
        data?: OmitStrict<ErrorOpenApiResponse, 'type' | 'status'>
    ): MethodDecorator {
        return (target, propertyKey) => {
            const ctor: Function = target.constructor;
            // eslint-disable-next-line unicorn/error-message
            const stack: string = new Error().stack ?? '';
            MetadataUtilities.setFilePath(ctor, stack);

            const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(ctor, propertyKey.toString());
            responses.push({
                ...data,
                type: 'json',
                cls: undefined,
                isArray: undefined,
                status
            });
            MetadataUtilities.setRouteResponses(ctor, responses, propertyKey.toString());
        };
    }
}