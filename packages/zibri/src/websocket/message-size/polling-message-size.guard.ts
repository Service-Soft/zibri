import { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';

import { WebsocketMessageRefusalListener } from './message-size-limiting-web-socket-server.function';
import { PollingPayloadScanner } from './polling-payload.scanner';
import { WebsocketMessageLimitResolver, WebsocketMessageRefusal, WebsocketMessageSizeScanner } from './websocket-message-size.scanner';
import { HttpMethod } from '../../http/http-method.enum';
import { HttpStatus } from '../../http/http-status.enum';
import { KnownHeader } from '../../http/known-header.enum';
import { MimeType } from '../../http/mime-type.enum';
import { Route } from '../../routing/controller-route-configuration.model';

/**
 * A session of the websocket server's engine, as far as the guard needs one: its id, and when it ends.
 */
type EngineSession = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    id: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    on: (event: 'close', listener: () => void) => unknown
};

/**
 * The engine of the websocket server, as far as the guard needs it: it announces every session.
 */
export type PollingEngine = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    on: (event: 'connection', listener: (session: EngineSession) => void) => unknown
};

/**
 * Reads what clients send over long polling before the websocket server does, and answers a request
 * carrying a message over its size with 413 before the rest of the body arrives.
 *
 * A listener on the http server ahead of the websocket server's own. It reads the body only once
 * the websocket server starts reading it, so a request it answers for other reasons is not read at all.
 * The messages of one session are measured together, whichever requests carry them, because the
 * attachments of a binary event may arrive in a request after the event's own.
 */
export abstract class PollingMessageSizeGuard {

    /**
     * Installs the guard on the server.
     * @param server - The http server the websocket server is attached to.
     * @param path - Where the websocket server listens.
     * @param engine - The engine of the websocket server, which announces its sessions.
     * @param resolveMaxBytes - What a message of each event may weigh.
     * @param onRefused - Told of every request answered 413.
     */
    static install(
        server: HttpServer,
        path: Route,
        engine: PollingEngine,
        resolveMaxBytes: WebsocketMessageLimitResolver,
        onRefused: WebsocketMessageRefusalListener
    ): void {
        // one per session, from its handshake to its end, so a request naming a session the engine
        // does not have is left to the engine, which refuses it
        const sessions: Map<string, WebsocketMessageSizeScanner> = new Map();
        engine.on('connection', session => {
            sessions.set(session.id, new WebsocketMessageSizeScanner(resolveMaxBytes));
            session.on('close', () => sessions.delete(session.id));
        });

        server.prependListener('request', (req: IncomingMessage, res: ServerResponse) => {
            const sizes: WebsocketMessageSizeScanner | undefined = this.resolveSession(req, path, sessions);
            if (sizes == undefined) {
                return;
            }
            const scanner: PollingPayloadScanner = new PollingPayloadScanner(sizes);
            // eslint-disable-next-line typescript/typedef
            const onData = (chunk: Buffer | string): void => {
                const refusal: WebsocketMessageRefusal | undefined = scanner.push(
                    typeof chunk === 'string' ? chunk : chunk.toString('utf8')
                );
                if (refusal == undefined) {
                    return;
                }
                req.off('data', onData);
                onRefused(refusal);
                res.writeHead(HttpStatus.CONTENT_TOO_LARGE).end();
                // paused rather than destroyed, as a request body over its size is: node closes the
                // connection once the response is written over a body nobody finished reading
                req.pause();
            };
            // ahead of the websocket server's own listener, and only once it adds one: a request it
            // answers without reading the body is left unread
            // eslint-disable-next-line typescript/typedef
            const onNewListener = (event: string): void => {
                if (event === 'data') {
                    req.off('newListener', onNewListener);
                    req.prependListener('data', onData);
                }
            };
            req.on('newListener', onNewListener);
            req.on('end', () => scanner.end());
        });
    }

    /**
     * The session a request carries messages for.
     * @param req - The request.
     * @param path - Where the websocket server listens.
     * @param sessions - The sessions the engine has.
     * @returns The session's scanner, or undefined for a request that carries no messages of a session.
     */
    private static resolveSession(
        req: IncomingMessage,
        path: Route,
        sessions: Map<string, WebsocketMessageSizeScanner>
    ): WebsocketMessageSizeScanner | undefined {
        if (req.method !== HttpMethod.POST || req.url?.startsWith(`${path}/`) !== true) {
            return undefined;
        }
        // binary bodies are the older protocol's, which the websocket server refuses
        if (req.headers[KnownHeader.CONTENT_TYPE] === MimeType.OCTET_STREAM) {
            return undefined;
        }
        const query: URLSearchParams = new URL(req.url, 'http://localhost').searchParams;
        return query.get('transport') !== 'polling' ? undefined : sessions.get(query.get('sid') ?? '');
    }
}