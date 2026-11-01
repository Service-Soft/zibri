import { AddressInfo, createServer, Server, Socket } from 'node:net';
import { createSecureContext, TLSSocket } from 'node:tls';

/**
 * The key and certificate a server offering STARTTLS upgrades the connection with, both PEM.
 */
export type CapturingSmtpServerTls = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    key: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    cert: string
};

/**
 * A local SMTP server that accepts every message and keeps what was sent, headers included.
 *
 * It speaks no more of the protocol than nodemailer needs to get through one message: a greeting, an
 * EHLO answer that advertises nothing but STARTTLS, when it has a certificate, and a 250 for
 * everything else. Point an `SmtpEmailTransport` at `port` with `pool: false`, and with
 * `requireTls: false` when the server has no certificate.
 */
export class CapturingSmtpServer {
    private constructor(
        private readonly server: Server,
        /**
         * The port the server listens on.
         */
        readonly port: number,
        /**
         * Every message received so far, as it went over the wire: its headers, a blank line, its body.
         */
        readonly messages: string[]
    ) {}

    /**
     * Starts a server on a free port of the loopback interface.
     * @param tls - What the server upgrades a connection with when it is asked to. No STARTTLS when undefined.
     * @returns The listening server.
     * @throws When the server did not get a port.
     */
    static async start(tls?: CapturingSmtpServerTls): Promise<CapturingSmtpServer> {
        const messages: string[] = [];
        const server: Server = createServer((socket: Socket) => {
            // a socket the client drops mid conversation must not take the test process with it
            socket.on('error', () => {});
            socket.write('220 localhost ESMTP\r\n');
            CapturingSmtpServer.converse(socket, messages, tls);
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

        const address: AddressInfo | string | null = server.address();
        if (address == undefined || typeof address === 'string') {
            throw new Error('The smtp server listens on no port.');
        }
        return new CapturingSmtpServer(server, address.port, messages);
    }

    /**
     * Answers the commands of one connection, until it is upgraded or ends.
     * @param socket - The connection.
     * @param messages - Where a received message goes.
     * @param tls - What STARTTLS upgrades the connection with, or undefined to offer none.
     */
    private static converse(socket: Socket, messages: string[], tls: CapturingSmtpServerTls | undefined): void {
        let message: string[] | undefined;
        // a chunk can end anywhere, so only the lines it completes are read
        let received: string = '';

        const onData = (chunk: Buffer): void => {
            received += chunk.toString('utf8');
            const lines: string[] = received.split('\r\n');
            received = lines.pop() ?? '';
            for (const line of lines) {
                if (message != undefined) {
                    if (line === '.') {
                        messages.push(message.join('\r\n'));
                        message = undefined;
                        socket.write('250 2.0.0 queued\r\n');
                    }
                    else {
                        message.push(line);
                    }
                    continue;
                }
                if (!line.length) {
                    continue;
                }
                const command: string = line.slice(0, 4).toUpperCase();
                if (command === 'EHLO' && tls != undefined) {
                    socket.write('250-localhost\r\n250 STARTTLS\r\n');
                }
                else if (line.toUpperCase() === 'STARTTLS') {
                    // what a real server answers when it has no certificate
                    if (tls == undefined) {
                        socket.write('502 5.5.1 STARTTLS not supported\r\n');
                        continue;
                    }
                    // the client speaks tls from here on, so nothing more is read as text off the bare socket
                    socket.off('data', onData);
                    socket.write('220 ready\r\n');
                    const secured: TLSSocket = new TLSSocket(socket, { isServer: true, secureContext: createSecureContext(tls) });
                    secured.on('error', () => {});
                    CapturingSmtpServer.converse(secured, messages, undefined);
                    return;
                }
                else if (command === 'DATA') {
                    message = [];
                    socket.write('354 go ahead\r\n');
                }
                else if (command === 'QUIT') {
                    socket.write('221 bye\r\n');
                    socket.end();
                }
                else {
                    socket.write('250 localhost\r\n');
                }
            }
        };
        socket.on('data', onData);
    }

    /**
     * Stops the server.
     */
    async close(): Promise<void> {
        await new Promise<void>(resolve => this.server.close(() => resolve()));
    }
}
