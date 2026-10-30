
import { ResponseDecorator } from './response-decorator.type';
import { type KeysetPage, KeysetPageClass, type PaginationResult, PaginationResultClass } from '../../data-source/models/pagination-result.model';
import { HttpStatus } from '../../http/http-status.enum';
import { type RedirectResponse } from '../../http/redirect-response.model';
import { type FileResponse } from '../../parsing/form-data/file-response.model';
import { type HtmlResponse } from '../../parsing/html/html-response.model';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { JsonOpenApiResponse, EmptyOpenApiResponse, ErrorOpenApiResponse, FileOpenApiResponse, OpenApiResponse, HtmlOpenApiResponse, RedirectOpenApiResponse } from '../open-api.model';
/**
 * Bundles decorators for http responses.
 */
// eslint-disable-next-line typescript/no-namespace
export namespace Response {

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * A single object response, json by default. With `mimeTypes`, it can also be written as xml, picked by the
     * request's `Accept` header. Several of them with the same status are one of their classes.
     * @param entityClass - The class that defines the response objects structure, or a function answering it
     * for a class that is only known once the application has started.
     * @param data - Additional configuration, like status, description or the formats it can be written in.
     */
    export function object<T>(
        entityClass: Newable<T> | (() => Newable<T> | undefined),
        data?: OmitStrict<JsonOpenApiResponse, 'isArray' | 'type' | 'cls'>
    ): ResponseDecorator<T> {
        return (target, propertyKey) => {
            const ctor: Function = target.constructor;
            MetadataUtilities.setFilePath(ctor);

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

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * An array json response.
     * @param entityClass - The class that defines the items in the response array.
     * @param data - Additional configuration, like status or description.
     */
    export function array<T>(
        entityClass: Newable<T>,
        data?: OmitStrict<JsonOpenApiResponse, 'isArray' | 'type' | 'cls' | 'mimeTypes'>
    ): ResponseDecorator<T[]> {
        return (target, propertyKey) => {
            const ctor: Function = target.constructor;
            MetadataUtilities.setFilePath(ctor);

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

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * A paginated result response, json by default. With `mimeTypes`, it can also be written as xml, picked by the
     * request's `Accept` header.
     * @param entityClass - The class that defines the paginated items response structure.
     * @param data - Additional configuration, like status, description or the formats it can be written in.
     */
    export function paginated<T>(
        entityClass: Newable<T>,
        data?: OmitStrict<JsonOpenApiResponse, 'isArray' | 'type' | 'cls'>
    ): ResponseDecorator<PaginationResult<T>> {
        return (target, propertyKey) => {
            const ctor: Function = target.constructor;
            MetadataUtilities.setFilePath(ctor);

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

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * A response of one page of a keyset read, and the cursor the next page is read with. Json by default; with
     * `mimeTypes`, it can also be written as xml, picked by the request's `Accept` header.
     * @param entityClass - The class that defines the paginated items response structure.
     * @param data - Additional configuration, like status, description or the formats it can be written in.
     */
    export function keysetPage<T>(
        entityClass: Newable<T>,
        data?: OmitStrict<JsonOpenApiResponse, 'isArray' | 'type' | 'cls'>
    ): ResponseDecorator<KeysetPage<T>> {
        return (target, propertyKey) => {
            const ctor: Function = target.constructor;
            MetadataUtilities.setFilePath(ctor);

            const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(ctor, propertyKey.toString());
            responses.push({
                description: `one page of ${entityClass.name} entities, and the cursor for the next`,
                status: HttpStatus.OK,
                ...data,
                isArray: false,
                cls: KeysetPageClass(entityClass),
                type: 'json'
            });
            MetadataUtilities.setRouteResponses(ctor, responses, propertyKey.toString());
        };
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * An empty response where nothing is returned. It has no body in any format, so it goes with json and xml by
     * default; next to a response written in json alone, say `mimeTypes: [MimeType.JSON]`.
     * @param data - Additional configuration, like description or the formats the route answers in.
     */
    export function empty(
        data?: OmitStrict<EmptyOpenApiResponse, 'type'>
    ): ResponseDecorator<undefined> {
        return (target, propertyKey) => {
            const ctor: Function = target.constructor;
            MetadataUtilities.setFilePath(ctor);

            const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(ctor, propertyKey.toString());
            responses.push({
                status: HttpStatus.NO_CONTENT,
                ...data,
                type: 'empty'
            });
            MetadataUtilities.setRouteResponses(ctor, responses, propertyKey.toString());
        };
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * A response where a file is returned.
     * @param data - Additional data, like mime type or description.
     */
    export function file(data?: OmitStrict<FileOpenApiResponse, 'type'>): ResponseDecorator<FileResponse> {
        return (target, propertyKey) => {
            const ctor: Function = target.constructor;
            MetadataUtilities.setFilePath(ctor);

            const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(ctor, propertyKey.toString());
            responses.push({
                ...data,
                type: 'file'
            });
            MetadataUtilities.setRouteResponses(ctor, responses, propertyKey.toString());
        };
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * A response that returns html.
     * @param data - Additional data, like status or description.
     */
    export function html(data?: OmitStrict<HtmlOpenApiResponse, 'type'>): ResponseDecorator<HtmlResponse> {
        return (target, propertyKey) => {
            const ctor: Function = target.constructor;
            MetadataUtilities.setFilePath(ctor);

            const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(ctor, propertyKey.toString());
            responses.push({
                ...data,
                type: 'html'
            });
            MetadataUtilities.setRouteResponses(ctor, responses, propertyKey.toString());

        };
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * A response that sends the caller on to another url, returned as a `RedirectResponse`.
     * @param data - Additional data, like the status or a description. The status defaults to 303 See Other,
     * which a client follows with a GET.
     */
    export function redirect(data?: Partial<OmitStrict<RedirectOpenApiResponse, 'type'>>): ResponseDecorator<RedirectResponse> {
        return (target, propertyKey) => {
            const ctor: Function = target.constructor;
            MetadataUtilities.setFilePath(ctor);

            const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(ctor, propertyKey.toString());
            responses.push({
                status: HttpStatus.SEE_OTHER,
                ...data,
                type: 'redirect'
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
            MetadataUtilities.setFilePath(ctor);

            const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(ctor, propertyKey.toString());
            responses.push({
                ...data,
                type: 'error',
                status
            });
            MetadataUtilities.setRouteResponses(ctor, responses, propertyKey.toString());
        };
    }
}