import assert from 'node:assert';
import { createServer, Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Server, Socket } from 'socket.io';
import { io, Socket as ClientSocket } from 'socket.io-client';

import { SocketIOWebsocketConnection } from './socket-io-websocket-connection.model';

let http: HttpServer;
let server: Server;
let url: string;

beforeAll(async () => {
    http = createServer();
    server = new Server(http);
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    const address: string | AddressInfo | null = http.address();
    assert(address != undefined && typeof address !== 'string', 'the server is not listening on a port');
    url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    await server.close();
});

describe('a SocketIOWebsocketConnection created as in 3.2, without the request of its handshake', () => {
    it('reads the headers and the query of its handshake off its socket', async () => {
        const connected: Promise<SocketIOWebsocketConnection> = new Promise(resolve => {
            server.once('connection', (socket: Socket) => {
                resolve(new SocketIOWebsocketConnection(socket, undefined, { value: '1.0.0', startsAt: new Date(0) }));
            });
        });
        // a websocket from the start, which leaves no request of long polling running once the client is closed
        const client: ClientSocket = io(url, { query: { client: 'of-3.2' }, extraHeaders: { 'x-client': 'of-3.2' }, transports: ['websocket'] });
        try {
            const connection: SocketIOWebsocketConnection = await connected;

            expect(connection.handshakeRequest).toMatchObject({
                headers: { 'x-client': 'of-3.2' },
                query: { client: 'of-3.2' },
                body: undefined,
                params: {}
            });
        }
        finally {
            client.close();
        }
    });
});