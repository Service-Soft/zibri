import { inject, ZIBRI_DI_TOKENS } from '../di';
import { GlobalRegistry } from '../global';
import { BodyParserInterface } from './body-parser.interface';
import { HttpRequest, isHttpRequest, isMimeType, KnownHeader, MimeType } from '../http';
import { ParserInterface } from './parser.interface';
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
        object: parseObject,
        array: parseArray
    };

    private readonly headerParamParseFunctions: Record<HeaderParamMetadata['type'], HeaderParamParseFunction> = {
        string: parseString,
        number: parseNumber,
        boolean: parseBoolean,
        date: parseDate,
        object: parseObject,
        array: parseArray
    };

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    parseHeaderParam(req: HttpRequest | WebsocketRequest, metadata: HeaderParamMetadata): unknown {
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
    async parseRequestBody(req: HttpRequest | WebsocketRequest, metadata: BodyMetadata): Promise<unknown> {
        let contentType: string = req.headers['Content-Type']?.split(';')[0]?.trim().toLowerCase() ?? '';
        if (!contentType.length && !isHttpRequest(req)) {
            contentType = MimeType.JSON;
        }

        if (!isMimeType(contentType)) {
            throw new Error(`Unsupported Content-Type: "${contentType}"`);
        }
        if (metadata.type !== contentType) {
            throw new Error(`Unsupported Content-Type: "${contentType}"`);
        }
        const fittingParsers: BodyParserInterface[] = this.bodyParsers.filter(p => p.contentType === contentType);
        if (!fittingParsers.length) {
            throw new Error(`Unsupported Content-Type: "${contentType}"`);
        }
        if (fittingParsers.length > 1) {
            throw new Error(`There has been more than one body parser provided for the Content-Type "${contentType}"`);
        }
        return await fittingParsers[0].parse(req, metadata);
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