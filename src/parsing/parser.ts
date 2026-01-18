import assert from 'assert';

import { inject, ZIBRI_DI_TOKENS } from '../di';
import { GlobalRegistry } from '../global';
import { BodyParserInterface } from './body-parser.interface';
import { HttpRequest, isHttpRequest, isMimeType, KnownHeader, MimeType } from '../http';
import { ParserInterface } from './parser.interface';
import { HttpClientResponse, isHttpClientResponse } from '../http-client';
import { LoggerInterface } from '../logging';
import { BodyMetadata, HeaderParamMetadata, PathParamMetadata, QueryParamMetadata } from '../routing';
import { parseArray, parseBoolean, parseDate, parseNumber, parseObject, parseString } from './functions';
import { ZibriApplication } from '../application';
import { WebsocketRequest } from '../websocket';

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
 * Default parser implementation of Zibri.
 */
export class Parser implements ParserInterface {
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

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    parseHeaderParam(req: HttpRequest | WebsocketRequest | HttpClientResponse, metadata: HeaderParamMetadata): unknown {
        const rawValue: string | undefined = req.headers[metadata.name as KnownHeader];
        return this.headerParamParseFunctions[metadata.type](rawValue, metadata);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    parseQueryParam(req: HttpRequest | WebsocketRequest, metadata: QueryParamMetadata): unknown {
        const rawValue: string | undefined = req.query?.[metadata.name];
        return this.queryParamParseFunctions[metadata.type](rawValue, metadata);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    parsePathParam(req: HttpRequest | WebsocketRequest, metadata: PathParamMetadata): unknown {
        const rawValue: string | undefined = req.params?.[metadata.name];
        return this.pathParamParseFunctions[metadata.type](rawValue, metadata);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async parseBody(req: HttpRequest | WebsocketRequest | HttpClientResponse, metadata: BodyMetadata): Promise<unknown> {
        const contentTypeHeader: string | undefined = req.headers[KnownHeader.CONTENT_TYPE]
            ?? req.headers[KnownHeader.CONTENT_TYPE.toLowerCase() as KnownHeader];
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
            throw new Error(`Unsupported ${KnownHeader.CONTENT_TYPE}: "${contentType}"`);
        }
        if (metadata.type !== contentType) {
            throw new Error(`Unsupported ${KnownHeader.CONTENT_TYPE}: "${contentType}"`);
        }
        const fittingParsers: BodyParserInterface[] = this.bodyParsers.filter(p => p.contentType === contentType);
        if (!fittingParsers.length) {
            throw new Error(`Unsupported ${KnownHeader.CONTENT_TYPE}: "${contentType}"`);
        }
        if (fittingParsers.length > 1) {
            throw new Error(`There has been more than one body parser provided for the ${KnownHeader.CONTENT_TYPE} "${contentType}"`);
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
    async attachTo(app: ZibriApplication): Promise<void> {
        await this.logger.info(`registers ${GlobalRegistry.bodyParsers.length} request body parsers:`);
        for (const parserClass of GlobalRegistry.bodyParsers) {
            const parser: BodyParserInterface = inject(parserClass);
            this.bodyParsers.push(parser);
            await this.logger.info(`  - ${parserClass.name} (${parser.contentType})`);
            await parser.attachTo?.(app);
        }
    }
}