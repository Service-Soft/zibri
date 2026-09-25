import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { ClusterInstance, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { clusterBroadcastEvent } from './websocket.instance-options';
import { FsUtilities } from '../../../utilities/fs.utilities';

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
});