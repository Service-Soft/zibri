import assert from 'assert';

import { BodyParserInterface, isBodyParser } from './body-parser.interface';
import { ParserInterface } from './parser.interface';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { getAllRegisteredTokens } from '../di/get-all-registered-tokens.function';
import { getDiTokenName } from '../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../di/get-registered-providers-of-variant.function';
import { inject } from '../di/inject.function';
import { DiProvider } from '../di/models/di-provider.model';
import { DiVariants } from '../di/models/di-variant.model';
import { UnsupportedMediaTypeError } from '../error-handling/errors/unsupported-media-type.error';
import { InternalError } from '../error-handling/internal-error.model';
import { OnAppInit } from '../global/on-app-init.interface';
import { HttpRequest, isHttpRequest } from '../http/http-request.model';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { isMimeType } from '../http/mime-type.helpers';
import { HttpClientResponse, isHttpClientResponse } from '../http-client/http-client-response.model';
import { LoggerInterface } from '../logging/logger.interface';
import { parseArray } from './functions/parse-array.function';
import { parseBoolean } from './functions/parse-boolean.function';
import { parseDate } from './functions/parse-date.function';
import { parseNumber } from './functions/parse-number.function';
import { parseObject } from './functions/parse-object.function';
import { parseString } from './functions/parse-string.function';
import { BodyMetadata } from '../routing/decorators/body.decorator';
import { PathParamMetadata, QueryParamMetadata, HeaderParamMetadata } from '../routing/decorators/param.decorator';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { WebsocketRequest } from '../websocket/models/websocket-request.model';

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
    private readonly bodyParsers: BodyParserInterface[] = [];

    private readonly pathParamParseFunctions: Record<PathParamMetadata['type'], PathParamParseFunction> = {
        string: parseString,
        number: parseNumber,
        boolean: parseBoolean,
        date: parseDate
    };

    private readonly queryParamParseFunctions: Record<QueryParamMetadata['type'], QueryParamParseFunction> = {
        string: parseString,
        number: parseNumber,
        boolean: parseBoolean,
        date: parseDate,
        object: (rawValue, meta) => {
            assert(meta.type === 'object');
            return parseObject(rawValue, meta.cls());
        },
        array: (rawValue, meta) => {
            assert(meta.type === 'array');
            return parseArray(rawValue, meta);
        }
    };

    private readonly headerParamParseFunctions: Record<HeaderParamMetadata['type'], HeaderParamParseFunction> = {
        string: parseString,
        number: parseNumber,
        boolean: parseBoolean,
        date: parseDate,
        object: (rawValue, meta) => {
            assert(meta.type === 'object');
            return parseObject(rawValue, meta.cls());
        },
        array: (rawValue, meta) => {
            assert(meta.type === 'array');
            return parseArray(rawValue, meta);
        }
    };

    private readonly id: string;

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
        this.id = UUIDUtilities.generate();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    parseHeaderParam(req: HttpRequest | WebsocketRequest | HttpClientResponse, metadata: HeaderParamMetadata): unknown {
        const rawValue: string | undefined = req.headers?.[metadata.name as KnownHeader];
        return this.headerParamParseFunctions[metadata.type](rawValue, metadata);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    parseQueryParam(req: HttpRequest | WebsocketRequest, metadata: QueryParamMetadata): unknown {
        const rawValue: string | undefined = req.query?.[metadata.name];
        const res: unknown = this.queryParamParseFunctions[metadata.type](rawValue, metadata);
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    parsePathParam(req: HttpRequest | WebsocketRequest, metadata: PathParamMetadata): unknown {
        const rawValue: string | undefined = req.params?.[metadata.name];
        return this.pathParamParseFunctions[metadata.type](rawValue, metadata);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async parseBody(req: HttpRequest | WebsocketRequest | HttpClientResponse, metadata: BodyMetadata): Promise<unknown> {
        const contentTypeHeader: string | undefined = req.headers?.[KnownHeader.CONTENT_TYPE]
            ?? req.headers?.[KnownHeader.CONTENT_TYPE.toLowerCase() as KnownHeader];
        let contentType: string = contentTypeHeader?.split(';')[0]?.trim().toLowerCase() ?? '';
        if (!contentType.length) {
            if (isHttpClientResponse(req)) {
                contentType = metadata.type;
            }
            else if (!isHttpRequest(req)) {
                contentType = MimeType.JSON;
            }
        }

        if (!isMimeType(contentType)) {
            throw new UnsupportedMediaTypeError(contentType);
        }
        if (metadata.type !== contentType) {
            throw new UnsupportedMediaTypeError(contentType);
        }

        const fittingParsers: BodyParserInterface[] = this.bodyParsers.filter(p => p.contentType === contentType);
        if (!fittingParsers.length) {
            throw new InternalError(`No body parser found for ${KnownHeader.CONTENT_TYPE}: "${contentType}"`);
        }
        if (fittingParsers.length > 1) {
            throw new InternalError(
                `There has been more than one body parser provided for ${KnownHeader.CONTENT_TYPE}: "${contentType}"`
            );
        }
        if (isHttpClientResponse(req)) {
            return await fittingParsers[0].parseFromHttpClientResponse(req, metadata);
        }
        if (isHttpRequest(req)) {
            return await fittingParsers[0].parseFromHttpRequest(req, metadata);
        }
        return await fittingParsers[0].parseFromWebsocketRequest(req, metadata);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(): Promise<void> {
        const providers: DiProvider<unknown>[] = getRegisteredProvidersOfVariant(DiVariants.BODY_PARSER);
        await this.logger.info(`registers ${providers.length} request body parsers:`);
        for (const provider of providers) {
            const parser: unknown = inject(provider.token);
            if (!isBodyParser(parser)) {
                throw new InitParserError(
                    `Invalid resource marked with @Backup: ${getDiTokenName(provider.token)} needs to implement BodyParserInterface`
                );
            }
            this.bodyParsers.push(parser);
            await this.logger.info(`  - ${getDiTokenName(provider.token)} (${parser.contentType})`);
        }

        const parsers: BodyParserInterface[] = getAllRegisteredTokens()
            .map(t => inject(t))
            .filter(i => isBodyParser(i));
        for (const parser of parsers) {
            if (!this.bodyParsers.find(c => c.constructor.name === parser.constructor.name)) {
                throw new InitParserError(
                    `The class "${parser.constructor.name}" seems to be a body parser but has not been decorated with @BodyParser()`
                );
            }
        }
    }
}