import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

import { JsonUtilities } from '../utilities/json.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * An order as the local PayPal holds it.
 */
type LocalOrder = {
    /**
     * The id of the order.
     */
    id: string,
    /**
     * The id of its capture, once it is captured.
     */
    captureId: string | undefined
};

/**
 * A request the local PayPal received.
 */
export type LocalPayPalCall = {
    /**
     * The method and the path, eg. `POST /v2/checkout/orders`.
     */
    route: string,
    /**
     * The idempotency key it was sent with, if any.
     */
    requestId: string | undefined,
    /**
     * The body, as it was sent.
     */
    body: string
};

/**
 * An answer, kept so that a request repeating an idempotency key gets it again.
 */
type LocalAnswer = {
    /**
     * The status.
     */
    status: number,
    /**
     * The body.
     */
    body: unknown
};

/**
 * The parts of PayPal's api the payment provider uses, served on a local port.
 *
 * What a test needs from PayPal is how it behaves around a capture: that a second capture of one order
 * is refused, that an answer can be lost after the capture happened, that a repeated idempotency key
 * is answered with the first answer. The real sandbox needs a buyer approving in a browser for every
 * order, which is what `pay-pal.payment-provider.test.ts` does; this serves the orders as approved.
 */
export class LocalPayPalServer {
    /**
     * Every request received, in order.
     */
    readonly calls: LocalPayPalCall[] = [];
    /**
     * Whether a capture answers 500 after it captured, the way a lost answer looks to the caller.
     */
    losesCaptureAnswers: boolean = false;
    /**
     * Whether looking an order up answers 500.
     */
    failsOrderLookups: boolean = false;

    private readonly orders: Map<string, LocalOrder> = new Map();
    private readonly answers: Map<string, LocalAnswer> = new Map();
    private server: Server | undefined;

    /**
     * Starts serving.
     * @returns The base url.
     */
    async start(): Promise<string> {
        const server: Server = createServer((req, res) => void this.handle(req, res));
        this.server = server;
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address: string | AddressInfo | null = server.address();
        if (address == undefined || typeof address === 'string') {
            throw new Error('the local PayPal is not listening on a port');
        }
        return `http://127.0.0.1:${address.port}`;
    }

    /**
     * Stops serving.
     */
    async stop(): Promise<void> {
        await new Promise<void>(resolve => this.server?.close(() => resolve()) ?? resolve());
    }

    /**
     * Counts the requests received on a route.
     * @param route - The method and the path pattern, eg. `POST /v2/checkout/orders/:id/capture`.
     * @returns How many there were.
     */
    countCalls(route: string): number {
        const pattern: RegExp = new RegExp(`^${route.replaceAll(':id', '[^/]+')}$`);
        return this.calls.filter(call => pattern.test(call.route)).length;
    }

    private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        // read to the end, so the client is not left writing into a socket nobody reads
        let body: string = '';
        req.setEncoding('utf8');
        for await (const chunk of req) {
            body += String(chunk);
        }
        const route: string = `${req.method} ${req.url}`;
        const header: string | string[] | undefined = req.headers['paypal-request-id'];
        const requestId: string | undefined = typeof header === 'string' ? header : undefined;
        this.calls.push({ route, requestId, body });

        const key: string | undefined = requestId == undefined ? undefined : `${route}#${requestId}`;
        const repeated: LocalAnswer | undefined = key == undefined ? undefined : this.answers.get(key);
        const answer: LocalAnswer = repeated ?? await this.resolveAnswer(req.method ?? '', req.url ?? '');
        if (key != undefined) {
            this.answers.set(key, answer);
        }
        res.writeHead(answer.status, { 'content-type': 'application/json' });
        res.end(JsonUtilities.stringify(answer.body));
    }

    private async resolveAnswer(method: string, url: string): Promise<LocalAnswer> {
        if (method === 'POST' && url === '/v1/oauth2/token') {
            return { status: 200, body: { access_token: 'local-token', expires_in: 3600 } };
        }
        if (method === 'POST' && url === '/v2/checkout/orders') {
            const order: LocalOrder = { id: UUIDUtilities.generate(), captureId: undefined };
            this.orders.set(order.id, order);
            return { status: 201, body: { id: order.id, status: 'CREATED', links: [{ href: `https://local/approve/${order.id}`, rel: 'approve' }] } };
        }
        const capture: RegExpMatchArray | null = url.match(/^\/v2\/checkout\/orders\/([^/]+)\/capture$/);
        if (method === 'POST' && capture?.[1] != undefined) {
            return await this.capture(capture[1]);
        }
        const lookup: RegExpMatchArray | null = url.match(/^\/v2\/checkout\/orders\/([^/]+)$/);
        if (method === 'GET' && lookup?.[1] != undefined) {
            return this.lookUp(lookup[1]);
        }
        return { status: 404, body: { name: 'RESOURCE_NOT_FOUND' } };
    }

    private async capture(orderId: string): Promise<LocalAnswer> {
        const order: LocalOrder | undefined = this.orders.get(orderId);
        if (order == undefined) {
            return { status: 404, body: { name: 'RESOURCE_NOT_FOUND' } };
        }
        if (order.captureId != undefined) {
            // later than the capture it repeats, so that its answer is the last one written
            await new Promise(resolve => setTimeout(resolve, 200));
            return { status: 422, body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] } };
        }
        order.captureId = UUIDUtilities.generate();
        if (this.losesCaptureAnswers) {
            return { status: 500, body: { name: 'INTERNAL_SERVER_ERROR' } };
        }
        return { status: 201, body: this.toOrderBody(order) };
    }

    private lookUp(orderId: string): LocalAnswer {
        const order: LocalOrder | undefined = this.orders.get(orderId);
        if (this.failsOrderLookups) {
            return { status: 500, body: { name: 'INTERNAL_SERVER_ERROR' } };
        }
        return order == undefined ? { status: 404, body: { name: 'RESOURCE_NOT_FOUND' } } : { status: 200, body: this.toOrderBody(order) };
    }

    private toOrderBody(order: LocalOrder): unknown {
        return {
            id: order.id,
            status: order.captureId == undefined ? 'APPROVED' : 'COMPLETED',
            purchase_units: [{ payments: { captures: order.captureId == undefined ? [] : [{ id: order.captureId, status: 'COMPLETED' }] } }]
        };
    }
}