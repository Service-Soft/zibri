import { connect, Socket } from 'node:net';

/**
 * The code a cancel request of the postgres wire protocol starts with, in place of a protocol version.
 */
const CANCEL_REQUEST_CODE: number = 80877102;

/**
 * Where a cancel request goes, and which statement it names.
 */
export type PostgresCancelRequest = {
    /**
     * The host the connection running the statement was opened to, or the directory of its unix socket.
     */
    host: string,
    /**
     * The port the connection running the statement was opened to.
     */
    port: number,
    /**
     * The process id the connection was given when it started.
     */
    processId: number,
    /**
     * The secret key the connection was given when it started.
     */
    secretKey: number
};

/**
 * Asks the server a connection was opened to, or the pooler in front of it, to stop the statement the
 * connection is running.
 *
 * The cancel request of the wire protocol, which is what libpq's own cancel sends: on a connection of
 * its own, naming the connection by the process id and secret key it was given when it started. A
 * pooler gives a connection a key of its own and passes the request on to the server connection the
 * client is on, which a `pg_cancel_backend` naming the pooler's process id cannot reach.
 * @param request - Where the request goes, and which statement it names.
 */
export async function sendPostgresCancelRequest(request: PostgresCancelRequest): Promise<void> {
    const packet: Buffer = Buffer.alloc(16);
    packet.writeInt32BE(16, 0);
    packet.writeInt32BE(CANCEL_REQUEST_CODE, 4);
    packet.writeInt32BE(request.processId, 8);
    packet.writeInt32BE(request.secretKey, 12);
    await new Promise<void>((resolve, reject) => {
        const socket: Socket = request.host.startsWith('/')
            ? connect(`${request.host}/.s.PGSQL.${request.port}`)
            : connect(request.port, request.host);
        socket.once('error', reject);
        socket.once('connect', () => socket.end(packet));
        // the server answers nothing, and closes the connection once it has read the request
        socket.once('close', () => resolve());
    });
}