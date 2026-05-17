import { BaseWebsocketConnection } from './connection/base-websocket-connection.model';
import { Property } from '../../entity/decorators/property.decorator';
import { HttpRequest } from '../../http/http-request.model';
import { KnownHeader } from '../../http/known-header.enum';

// eslint-disable-next-line jsdoc/require-jsdoc
class QueryObject implements Record<string, unknown> {
    [key: string]: unknown
}

// eslint-disable-next-line jsdoc/require-jsdoc
class ParamsObject extends QueryObject {}

// eslint-disable-next-line jsdoc/require-jsdoc
class HeadersObject implements Partial<Record<KnownHeader, unknown>> {
    [key: string]: unknown
}

/**
 * A websocket request sent from a client.
 */
export class WebsocketRequest<
    T = unknown,
    PathParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
    QueryParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
    HeaderParamsObject extends Record<string, unknown> = Partial<Record<KnownHeader, string | undefined>>
> implements Partial<Pick<
    HttpRequest<T, PathParamsObject, QueryParamsObject, HeaderParamsObject>,
    'headers' | 'body' | 'query' | 'params'>
> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.object({ cls: () => QueryObject, required: false, allowAdditionalProperties: true })
    query: QueryParamsObject | undefined;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.object({ cls: () => HeadersObject, allowAdditionalProperties: true })
    headers!: HeaderParamsObject;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.object({ cls: () => ParamsObject, required: false, allowAdditionalProperties: true })
    params: PathParamsObject | undefined;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.unknown({ required: false })
    body: T | undefined;
}

/**
 * A websocket request with the connection that belongs to it.
 */
export type WebsocketRequestWithConnection<Connection extends BaseWebsocketConnection> = {
    /**
     * The websocket request.
     */
    request: WebsocketRequest,
    /**
     * The connection that the request comes from.
     */
    connection: Connection
};