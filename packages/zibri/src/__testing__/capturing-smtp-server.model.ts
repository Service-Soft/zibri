import { AddressInfo, createServer, Server, Socket } from 'node:net';

/**
 * A local SMTP server that accepts every message and keeps what was sent, headers included.
 *
 * It speaks no more of the protocol than nodemailer needs to get through one message: a greeting, a
 * single line EHLO answer that advertises nothing (so no STARTTLS and no AUTH are attempted), and a
 * 250 for everything else. Point an `SmtpEmailTransport` at `port` with `pool: false`.
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
     * @returns The listening server.
     * @throws When the server did not get a port.
     */
    static async start(): Promise<CapturingSmtpServer> {
        const messages: string[] = [];
        const server: Server = createServer((socket: Socket) => {
            let message: string[] | undefined;
            // a chunk can end anywhere, so only the lines it completes are read
            let received: string = '';
            socket.write('220 localhost ESMTP\r\n');

            socket.on('data', (chunk: Buffer) => {
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
                    if (command === 'DATA') {
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
            });
            // a socket the client drops mid conversation must not take the test process with it
            socket.on('error', () => {});
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

        const address: AddressInfo | string | null = server.address();
        if (address == undefined || typeof address === 'string') {
            throw new Error('The smtp server listens on no port.');
        }
        return new CapturingSmtpServer(server, address.port, messages);
    }

    /**
     * Stops the server.
     */
    async close(): Promise<void> {
        await new Promise<void>(resolve => this.server.close(() => resolve()));
    }
}