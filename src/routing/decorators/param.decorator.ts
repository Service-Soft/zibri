import { MetadataUtilities } from '../../encapsulation';
import { KnownHeader } from '../../http';
import { Newable, OmitStrict } from '../../types';

export type PathParamMetadata = {
    name: string,
    description?: string,
    required: boolean,
    type: 'string' | 'number'
};

type BaseQueryParamMetadata = {
    name: string,
    description?: string,
    required: boolean
};

export type SimpleQueryParamMetadata = BaseQueryParamMetadata & {
    type: 'string' | 'number' | 'boolean' | 'date'
};

type SimpleQueryParamMetadataInput = Partial<OmitStrict<SimpleQueryParamMetadata, 'name'>>;

export type ObjectQueryParamMetadata = BaseQueryParamMetadata & {
    type: 'object',
    cls: Newable<unknown>
};

type ObjectQueryParamMetadataInput = OmitStrict<ObjectQueryParamMetadata, 'name' | keyof BaseQueryParamMetadata>
    & Partial<OmitStrict<BaseQueryParamMetadata, 'name'>>;

export type ArrayQueryParamMetadata = BaseQueryParamMetadata & {
    type: 'array',
    itemType: 'string' | 'number' | 'boolean' | 'date' | Newable<unknown>
};

type ArrayQueryParamMetadataInput = OmitStrict<ArrayQueryParamMetadata, 'name' | keyof BaseQueryParamMetadata>
    & Partial<OmitStrict<BaseQueryParamMetadata, 'name'>>;

export type QueryParamMetadata = SimpleQueryParamMetadata | ObjectQueryParamMetadata | ArrayQueryParamMetadata;

type QueryParamMetadataInput = SimpleQueryParamMetadataInput | ObjectQueryParamMetadataInput | ArrayQueryParamMetadataInput;

export type HeaderParamMetadata = {
    name: KnownHeader | Omit<string, KnownHeader>,
    description?: string,
    required: boolean,
    type: 'string' | 'number' | 'boolean' | 'date'
};

// eslint-disable-next-line typescript/no-namespace
export namespace Param {
    export function path(name: string, options: Partial<OmitStrict<PathParamMetadata, 'name'>> = {}): ParameterDecorator {
        const fullMetadata: PathParamMetadata = {
            name: name,
            required: true,
            type: 'string',
            ...options
        };
        return (target, propertyKey, parameterIndex) => {
            const ctor: Function = target.constructor;
            // eslint-disable-next-line unicorn/error-message
            const stack: string = new Error().stack ?? '';
            MetadataUtilities.setFilePath(ctor, stack);
            const key: string = propertyKey?.toString() ?? '';
            const pathParams: Record<number, PathParamMetadata> = MetadataUtilities.getRoutePathParams(ctor, key);
            pathParams[parameterIndex] = fullMetadata;
            MetadataUtilities.setRoutePathParams(ctor, pathParams, key);
        };
    }

    export function query(name: string, options: QueryParamMetadataInput = {}): ParameterDecorator {
        const fullMetadata: QueryParamMetadata = {
            name: name,
            required: true,
            type: 'string',
            ...options
        };
        return (target, propertyKey, parameterIndex) => {
            const ctor: Function = target.constructor;
            // eslint-disable-next-line unicorn/error-message
            const stack: string = new Error().stack ?? '';
            MetadataUtilities.setFilePath(ctor, stack);
            const key: string = propertyKey?.toString() ?? '';
            const queryParams: Record<number, QueryParamMetadata> = MetadataUtilities.getRouteQueryParams(ctor, key);
            queryParams[parameterIndex] = fullMetadata;
            MetadataUtilities.setRouteQueryParams(ctor, queryParams, key);
        };
    }

    export function header(
        name: KnownHeader | Omit<string, KnownHeader>,
        options: Partial<OmitStrict<HeaderParamMetadata, 'name'>> = {}
    ): ParameterDecorator {
        const fullMetadata: HeaderParamMetadata = {
            name: name,
            required: true,
            type: 'string',
            ...options
        };
        return (target, propertyKey, parameterIndex) => {
            const ctor: Function = target.constructor;
            // eslint-disable-next-line unicorn/error-message
            const stack: string = new Error().stack ?? '';
            MetadataUtilities.setFilePath(ctor, stack);
            const key: string = propertyKey?.toString() ?? '';
            const headerParams: Record<number, HeaderParamMetadata> = MetadataUtilities.getRouteHeaderParams(ctor, key);
            headerParams[parameterIndex] = fullMetadata;
            MetadataUtilities.setRouteHeaderParams(ctor, headerParams, key);
        };
    }
}