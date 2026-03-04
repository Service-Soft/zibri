import { BaseWebsocketConnection } from './connection/base-websocket-connection.model';
import { Property } from '../../entity/decorators/property.decorator';
import { HttpRequest } from '../../http/http-request.model';
import { KnownHeader } from '../../http/known-header.enum';

// eslint-disable-next-line jsdoc/require-jsdoc
class QueryObject implements Record<string, string | undefined> {
    [key: string]: string | undefined
}

// eslint-disable-next-line jsdoc/require-jsdoc
class ParamsObject extends QueryObject {}

// eslint-disable-next-line jsdoc/require-jsdoc
class HeadersObject implements Partial<Record<KnownHeader, string | undefined>> {
    [key: string]: string | undefined
}

/**
 * A websocket request sent from a client.
 */
export class WebsocketRequest implements Partial<Pick<HttpRequest, 'headers' | 'body' | 'query' | 'params'>> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.object({ cls: () => QueryObject, required: false, allowAdditionalProperties: true })
    query: QueryObject | undefined;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.object({ cls: () => HeadersObject, allowAdditionalProperties: true })
    headers!: Partial<Record<KnownHeader, string | undefined>>;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.object({ cls: () => ParamsObject, required: false, allowAdditionalProperties: true })
    params: ParamsObject | undefined;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.unknown({ required: false })
    body: unknown | undefined;
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