import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { ClusterInstance, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { clusterAskedEvent, clusterBroadcastEvent, ClusterLogin } from './websocket.instance-options';
import { FsUtilities } from '../../../utilities/fs.utilities';
import { WebsocketAnswer } from '../../../websocket/models/websocket-answer.model';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md section 1.10.
 *
 * A socket belongs to the instance that accepted it. Without an adapter, sending to all clients
 * reaches only the ones connected to the instance running the code - roughly one in N - and nothing
 * reports that the rest were missed. It looks like it worked.
 *
 * The clients here deliberately connect to *different* instances, which is the only arrangement
 * that can tell the difference.
 *
 * Every expectation describes the fixed behavior, so this file is red until the finding is closed.
 * See ../README.md for why.
 */

let cluster: StartedTestCluster | undefined;
const openSockets: Socket[] = [];

beforeAll(async () => {
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(__dirname, 'websocket.instance-options.ts'),
        instances: 2
    });
}, 15000);

afterAll(async () => {
    for (const socket of openSockets) {
        socket.close();
    }
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
}, 15000);

/**
 * Connects a client to the given instance and waits until it is actually connected.
 * @param baseUrl - The instance to connect to.
 * @returns The connected socket.
 */
async function connectClient(baseUrl: string): Promise<Socket> {
    const socket: Socket = io(baseUrl, { auth: { offset: 0 } });
    openSockets.push(socket);

    await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
    });
    return socket;
}

/**
 * Resolves when the socket receives the broadcast, rejects when it does not arrive in time.
 * @param socket - The socket to listen on.
 * @returns Whatever came with the event.
 */
async function waitForBroadcast(socket: Socket): Promise<unknown> {
    return await new Promise<unknown>((resolve, reject) => {
        const timeout: NodeJS.Timeout = setTimeout(
            () => reject(new Error('the broadcast never arrived at this client')),
            10000
        );
        socket.once(clusterBroadcastEvent, (payload: unknown) => {
            clearTimeout(timeout);
            resolve(payload);
        });
    });
}

describe('evaluation/04-infrastructure-subsystems 1.10 - websocket broadcasts across replicas', () => {

    it('delivers a broadcast to clients connected to a different instance', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const first: ClusterInstance = cluster.instanceAt(0);
        const second: ClusterInstance = cluster.instanceAt(1);

        // one client per instance, which is what a load balancer produces
        const onFirst: Socket = await connectClient(first.baseUrl);
        const onSecond: Socket = await connectClient(second.baseUrl);

        // listening before the broadcast is sent, so neither can miss it by being late
        const receivedOnFirst: Promise<unknown> = waitForBroadcast(onFirst);
        const receivedOnSecond: Promise<unknown> = waitForBroadcast(onSecond);

        const res: Response = await fetch(`${first.baseUrl}/cluster-websocket/broadcast`, { method: 'POST' });
        expect(res.status).toBe(204);

        // control: the client on the instance that sent it gets the broadcast. If this fails the
        // fixture is broken rather than the framework, and the assertion below means nothing.
        await expect(receivedOnFirst).resolves.toBeDefined();

        // and so does the one connected elsewhere. Today the socket belongs to the other instance,
        // which never hears about the broadcast at all.
        await expect(receivedOnSecond).resolves.toBeDefined();
    }, 30000);

    it('delivers the same json to clients connected to a different instance', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const onFirst: Socket = await connectClient(cluster.instanceAt(0).baseUrl);
        const onSecond: Socket = await connectClient(cluster.instanceAt(1).baseUrl);
        const receivedOnFirst: Promise<unknown> = waitForBroadcast(onFirst);
        const receivedOnSecond: Promise<unknown> = waitForBroadcast(onSecond);

        const res: Response = await fetch(`${cluster.instanceAt(0).baseUrl}/cluster-websocket/broadcast-values`, { method: 'POST' });
        expect(res.status).toBe(204);

        // the message is handed to socket.io as it was sent and written as json on the way out. The
        // copy that goes to the other instance is written by the adapter instead, and a bigint is
        // exactly what plain json refuses to write
        const data: { count: string, at: string } = { count: '18446744073709551616', at: '2026-01-02T03:04:05.000Z' };
        await expect(receivedOnFirst).resolves.toMatchObject({ data });
        await expect(receivedOnSecond).resolves.toMatchObject({ data });
    }, 30000);
});

describe('evaluation/04-infrastructure-subsystems 1.13 - answers of clients connected to another instance', () => {

    it('collects what a client connected to a different instance answers, naming its connection', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const first: ClusterInstance = cluster.instanceAt(0);
        const onFirst: Socket = await connectClient(first.baseUrl);
        const onSecond: Socket = await connectClient(cluster.instanceAt(1).baseUrl);
        for (const socket of [onFirst, onSecond]) {
            socket.on(clusterAskedEvent, (_message: unknown, ack: (answer: unknown) => void) => ack({ answeredBy: socket.id }));
        }

        const res: Response = await fetch(`${first.baseUrl}/cluster-websocket/ask-everyone`, { method: 'POST' });
        expect(res.ok).toBe(true);
        const answers: WebsocketAnswer[] = await res.json() as WebsocketAnswer[];

        // the sockets of the cases before are still open and answer nothing, so they are listed as
        // well, with the error of their timeout
        // control: the client of the instance that asked
        expect(answers).toContainEqual({ request: { answeredBy: onFirst.id }, connectionId: onFirst.id, userId: undefined });
        // the instance that asked never held this socket, and only the other one could ask it
        expect(answers).toContainEqual({ request: { answeredBy: onSecond.id }, connectionId: onSecond.id, userId: undefined });
    }, 30000);
});

describe('evaluation/02-http-runtime-core M17 - a socket whose login ended, on another instance', () => {

    it('closes the socket of a deactivated user on the instance that holds it', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const first: ClusterInstance = cluster.instanceAt(0);
        const second: ClusterInstance = cluster.instanceAt(1);
        const loggedIn: Response = await fetch(`${first.baseUrl}/cluster-websocket/login`, { method: 'POST' });
        // checked here, because the socket below connects without a login as well and the failure
        // would only surface later, as a deactivation of nobody
        expect(loggedIn.ok).toBe(true);
        const login: ClusterLogin = await loggedIn.json() as ClusterLogin;

        // connected to the instance the deactivation does not run on, which is the one that has to be told
        const socket: Socket = io(second.baseUrl, { auth: { offset: 0 }, extraHeaders: { authorization: `Bearer ${login.accessToken}` }, reconnection: false });
        openSockets.push(socket);
        await new Promise<void>((resolve, reject) => {
            socket.once('connect', () => resolve());
            socket.once('connect_error', reject);
        });
        const closed: Promise<boolean> = new Promise<boolean>(resolve => {
            const timeout: NodeJS.Timeout = setTimeout(() => resolve(false), 10000);
            socket.once('disconnect', () => {
                clearTimeout(timeout);
                resolve(true);
            });
        });

        const res: Response = await fetch(`${first.baseUrl}/cluster-websocket/deactivate/${login.userId}`, { method: 'POST' });
        expect(res.status).toBe(204);

        expect(await closed).toBe(true);
    }, 30000);
});