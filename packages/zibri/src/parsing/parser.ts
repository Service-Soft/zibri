import assert from 'assert';

import { AnyBodyParser, BodyParserInterface, BodyParserMetadata, isBodyParser } from './body-parser.interface.ts';
import { ParserInterface } from './parser.interface.ts';
import { Injectable } from '../di/decorators/injectable.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { getAllInstantiatedValues } from '../di/get-all-instantiated-values.function.ts';
import { getDiTokenName } from '../di/get-di-token-name.function.ts';
import { getRegisteredProvidersOfVariant } from '../di/get-registered-providers-of-variant.function.ts';
import { inject } from '../di/inject.function.ts';
import { DiProvider } from '../di/models/di-provider.model.ts';
import { DiVariants } from '../di/models/di-variant.model.ts';
import { UnsupportedMediaTypeError } from '../error-handling/errors/unsupported-media-type.error.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { OnAppInit } from '../global/on-app-init.interface.ts';
import { HttpRequest, isHttpRequest } from '../http/http-request.model.ts';
import { KnownHeader } from '../http/known-header.enum.ts';
import { MimeType } from '../http/mime-type.enum.ts';
import { isJsonMimeType, isMimeType, isXmlMimeType } from '../http/mime-type.helpers.ts';
import { HttpClientResponse, isHttpClientResponse } from '../http-client/http-client-response.model.ts';
import { LoggerInterface } from '../logging/logger.interface.ts';
import { parseArray } from './functions/parse-array.function.ts';
import { parseBoolean } from './functions/parse-boolean.function.ts';
import { parseDate } from './functions/parse-date.function.ts';
import { parseNumber } from './functions/parse-number.function.ts';
import { parseObject } from './functions/parse-object.function.ts';
import { parseAnyOf } from './functions/parse-one-of.function.ts';
import { parseString } from './functions/parse-string.function.ts';
import { BodyMetadata } from '../routing/decorators/body-metadata.model.ts';
import { PathParamMetadata, QueryParamMetadata, HeaderParamMetadata } from '../routing/decorators/param.decorator.ts';
import { WebsocketRequest } from '../websocket/models/websocket-request.model.ts';

/**
 * Function for parsing path parameters.
 */
type PathParamParseFunction = (rawValue: string | undefined, meta: PathParamMetadata) => unknown;

/**
 * Function for parsing query parameters.
 */
type QueryParamParseFunction = (rawValue: unknown, meta: QueryParamMetadata) => unknown;

/**
 * Function for parsing header parameters.
 */
type HeaderParamParseFunction = (rawValue: string | undefined, meta: HeaderParamMetadata) => unknown;

/**
 * An error to throw during parser initialization.
 */
class InitParserError extends InternalError {
    constructor(message: string | string[]) {
        const messageArray: string[] = typeof message === 'string' ? [message] : message;
        super(['Error initializing parser.', ...messageArray]);
        this.name = 'InitParserError';
    }
}

/**
 * Default parser implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class Parser implements ParserInterface, OnAppInit {
    private readonly logger: LoggerInterface;
    private readonly bodyParsers: AnyBodyParser[] = [];

    private readonly pathParamParseFunctions: Record<PathParamMetadata['type'], PathParamParseFunction> = {
        string: parseString,
        number: (rawValue, meta) => {
            assert(meta.type === 'number');
            return parseNumber(rawValue, meta.format);
        },
        boolean: parseBoolean,
        date: parseDate,
        oneOf: (rawValue, meta) => {
            assert(meta.type === 'oneOf');
            return parseAnyOf(rawValue, meta);
        }
    };

    private readonly queryParamParseFunctions: Record<QueryParamMetadata['type'], QueryParamParseFunction> = {
        string: parseString,
        number: (rawValue, meta) => {
            assert(meta.type === 'number');
            return parseNumber(rawValue, meta.format);
        },
        boolean: parseBoolean,
        date: parseDate,
        object: (rawValue, meta) => {
            assert(meta.type === 'object');
            return parseObject(rawValue, meta.cls());
        },
        array: (rawValue, meta) => {
            assert(meta.type === 'array');
            return parseArray(rawValue, meta.items);
        },
        oneOf: (rawValue, meta) => {
            assert(meta.type === 'oneOf');
            return parseAnyOf(rawValue, meta);
        }
    };

    private readonly headerParamParseFunctions: Record<HeaderParamMetadata['type'], HeaderParamParseFunction> = {
        string: parseString,
        number: (rawValue, meta) => {
            assert(meta.type === 'number');
            return parseNumber(rawValue, meta.format);
        },
        boolean: parseBoolean,
        date: parseDate,
        object: (rawValue, meta) => {
            assert(meta.type === 'object');
            return parseObject(rawValue, meta.cls());
        },
        array: (rawValue, meta) => {
            assert(meta.type === 'array');
            return parseArray(rawValue, meta.items);
        },
        oneOf: (rawValue, meta) => {
            assert(meta.type === 'oneOf');
            return parseAnyOf(rawValue, meta);
        }
    };

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    parseHeaderParam(req: HttpRequest | WebsocketRequest | HttpClientResponse, metadata: HeaderParamMetadata): unknown {
        const rawValue: string | undefined = req.headers?.[metadata.name as KnownHeader];
        return this.headerParamParseFunctions[metadata.type](rawValue, metadata);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    parseQueryParam(req: HttpRequest | WebsocketRequest, metadata: QueryParamMetadata): unknown {
        const rawValue: string | undefined = req.query?.[metadata.name];
        const res: unknown = this.queryParamParseFunctions[metadata.type](rawValue, metadata);
        return res;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    parsePathParam(req: HttpRequest | WebsocketRequest, metadata: PathParamMetadata): unknown {
        const rawValue: string | undefined = req.params?.[metadata.name];
        return this.pathParamParseFunctions[metadata.type](rawValue, metadata);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async parseBody(req: HttpRequest | WebsocketRequest | HttpClientResponse, metadata: BodyMetadata): Promise<unknown> {
        const contentTypeHeader: string | undefined = req.headers?.[KnownHeader.CONTENT_TYPE]
            ?? req.headers?.[KnownHeader.CONTENT_TYPE.toLowerCase() as KnownHeader];
        let contentType: string = contentTypeHeader?.split(';')[0]?.trim().toLowerCase() ?? '';
        // a response or a websocket message that names no type is read as what it was declared as,
        // since neither has a sender that was asked to say. A http request that names none is refused
        if (!contentType.length && !isHttpRequest(req)) {
            contentType = metadata.type;
        }
        // xml has several media types, and every one of them is read by the same parser
        if (isXmlMimeType(contentType)) {
            contentType = MimeType.XML;
        }
        // json has many media types too, everything with the `+json` suffix, and the json parser reads
        // them all: a body declared as plain json takes any of them, one declared as a specific one
        // only that one
        if (metadata.type === MimeType.JSON && isJsonMimeType(contentType)) {
            contentType = MimeType.JSON;
        }
        // a response declared as a stream is handed over as the bytes that arrived, which nothing reads by
        // their type, and a service labels them as it likes: an object store answers with whatever type the
        // object was stored with, eg. binary/octet-stream. A http request is still refused, since what a
        // route accepts is part of what it declares
        if (metadata.type === MimeType.OCTET_STREAM && isHttpClientResponse(req)) {
            contentType = MimeType.OCTET_STREAM;
        }

        if (!isMimeType(contentType)) {
            throw new UnsupportedMediaTypeError(contentType);
        }
        if (metadata.type !== contentType) {
            throw new UnsupportedMediaTypeError(contentType);
        }

        // the cases only read the same: each narrows metadata to its own type, which is what lets it
        // reach the parser typed for it - merged, they would need one parser that accepts every metadata
        switch (metadata.type) {
            case MimeType.JSON:
            case MimeType.JSON_LD:
            case MimeType.JSON_SCIM: {
                return await this.parseBodyWith(this.findBodyParser(MimeType.JSON), req, metadata);
            }
            case MimeType.XML: {
                return await this.parseBodyWith(this.findBodyParser(metadata.type), req, metadata);
            }
            case MimeType.FORM_DATA: {
                return await this.parseBodyWith(this.findBodyParser(metadata.type), req, metadata);
            }
            case MimeType.FORM_URL_ENCODED: {
                return await this.parseBodyWith(this.findBodyParser(metadata.type), req, metadata);
            }
            case MimeType.OCTET_STREAM: {
                return await this.parseBodyWith(this.findBodyParser(metadata.type), req, metadata);
            }
        }
    }

    private findBodyParser<M extends MimeType>(contentType: M): BodyParserInterface<M> {
        const fittingParsers: BodyParserInterface<M>[] = this.bodyParsers.filter(
            (p): p is Extract<AnyBodyParser, BodyParserInterface<M>> => p.contentType === contentType
        );
        const parser: BodyParserInterface<M> | undefined = fittingParsers[0];
        if (parser == undefined) {
            throw new InternalError(`No body parser found for ${KnownHeader.CONTENT_TYPE}: "${contentType}"`);
        }
        if (fittingParsers.length > 1) {
            throw new InternalError(
                `There has been more than one body parser provided for ${KnownHeader.CONTENT_TYPE}: "${contentType}"`
            );
        }
        return parser;
    }

    private async parseBodyWith<M extends MimeType>(
        parser: BodyParserInterface<M>,
        req: HttpRequest | WebsocketRequest | HttpClientResponse,
        metadata: BodyParserMetadata<M>
    ): Promise<unknown> {
        if (isHttpClientResponse(req)) {
            return await parser.parseFromHttpClientResponse(req, metadata);
        }
        if (isHttpRequest(req)) {
            return await parser.parseFromHttpRequest(req, metadata);
        }
        return await parser.parseFromWebsocketRequest(req, metadata);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    onAppInit(): void {
        const providers: DiProvider<unknown>[] = getRegisteredProvidersOfVariant(DiVariants.BODY_PARSER);
        this.logger.info(`registers ${providers.length} request body parsers:`);
        for (const provider of providers) {
            const parser: unknown = inject(provider.token);
            if (!isBodyParser(parser)) {
                throw new InitParserError(
                    `Invalid resource marked with @BodyParser: ${getDiTokenName(provider.token)} needs to implement BodyParserInterface`
                );
            }
            this.bodyParsers.push(parser);
            this.logger.info(`  - ${getDiTokenName(provider.token)} (${parser.contentType})`);
        }

        // among what the application has actually built, rather than everything registered - see
        // `CacheService.onAppInit` for why the second question is the expensive one
        const parsers: AnyBodyParser[] = getAllInstantiatedValues().filter(i => isBodyParser(i));
        for (const parser of parsers) {
            if (!this.bodyParsers.find(c => c.constructor.name === parser.constructor.name)) {
                throw new InitParserError(
                    `The class "${parser.constructor.name}" seems to be a body parser but has not been decorated with @BodyParser()`
                );
            }
        }
    }
}