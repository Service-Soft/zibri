import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io, Socket } from 'socket.io-client';

import { SemVerVersion } from './sem-ver.utilities.ts';
import { VersionFile } from './version.model.ts';
import { testFileFolder } from '../__testing__/constants.ts';
import { defaultTestServerProviders } from '../__testing__/test-server/providers.ts';
import { startTestServer, StartedTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { HttpRequestContext } from '../context/request/http-request.context.ts';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../context/request/request-context-token.model.ts';
import { WebsocketRequestContext } from '../context/request/websocket-request.context.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { Newable } from '../types/newable.type.ts';
import { FsPath, FsUtilities } from '../utilities/fs.utilities.ts';
import { JsonUtilities } from '../utilities/json.utilities.ts';
import { WebsocketController } from '../websocket/decorators/websocket-controller.decorator.ts';
import { WebsocketRoute } from '../websocket/decorators/websocket-route.decorator.ts';
import { WebsocketEvent } from '../websocket/models/websocket-event.enum.ts';
import { WebsocketMessage } from '../websocket/models/websocket-message.model.ts';

const testVersionsDir: FsPath = FsUtilities.getPath(testFileFolder, 'versions-ws');

@WebsocketController({ allowOrphan: true, versions: 'all' })
class VersionResolveController {
    @WebsocketRoute('resolve-version')
    async resolveVersion(): Promise<unknown> {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!context) {
            throw new Error('context missing');
        }
        return context.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_VERSION);
    }
}

@WebsocketController({ allowOrphan: true, eventPrefix: 'dispatch:' })
class VersionedDispatchController {
    @WebsocketRoute('event', { versions: ['1.0.0'] })
    handleV1(): { handler: string } {
        return { handler: 'v1' };
    }

    @WebsocketRoute('event', { versions: ['2.0.0'] })
    handleV2(): { handler: string } {
        return { handler: 'v2' };
    }

    @WebsocketRoute('latest-only', { versions: ['latest'] })
    handleLatest(): { handler: string } {
        return { handler: 'latest' };
    }

    @WebsocketRoute('only-all', { versions: 'all' })
    handleAll(): { handler: string } {
        return { handler: 'all' };
    }

    @WebsocketRoute('only-v1', { versions: ['1.0.0'] })
    handleOnlyV1(): { handler: string } {
        return { handler: 'v1' };
    }
}

let server: StartedTestServer;
let baseUrl: string;

async function writeVersionFile(file: VersionFile): Promise<void> {
    const filePath: FsPath = FsUtilities.getPath(testVersionsDir, `${file.value}.json`);
    await FsUtilities.mkdir(testVersionsDir);
    await FsUtilities.upsertFile(filePath, JsonUtilities.stringify(file));
}

async function restartServer(options: { version?: SemVerVersion, websocketControllers?: Newable<unknown>[] } = {}): Promise<void> {
    await server.reInit(options);
    baseUrl = await server.start();
}

async function sendWsEvent(
    url: string,
    event: string,
    payload: unknown = {},
    versionHeader?: string
): Promise<WebsocketMessage> {
    return new Promise((resolve, reject) => {
        const socket: Socket = io(url, {
            auth: { offset: 0 },
            extraHeaders: versionHeader ? { 'x-version': versionHeader } : {}
        });

        const timeout: NodeJS.Timeout = setTimeout(() => {
            socket.disconnect();
            reject(new Error('Timed out waiting for websocket response'));
        }, 5000);

        socket.once(WebsocketEvent.RESPONSE, (msg: WebsocketMessage, ack?: () => void) => {
            clearTimeout(timeout);
            ack?.();
            socket.disconnect();
            resolve(msg);
        });

        socket.once('connect', () => {
            socket.emit(event, payload);
        });

        socket.once('connect_error', err => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

async function expectWsConnectError(
    url: string,
    versionHeader: string
): Promise<Error> {
    return new Promise((resolve, reject) => {
        const socket: Socket = io(url, {
            auth: { offset: 0 },
            extraHeaders: { 'x-version': versionHeader }
        });

        socket.once('connect', () => {
            socket.disconnect();
            reject(new Error('Expected connect_error but socket connected'));
        });

        socket.once('connect_error', err => {
            socket.disconnect();
            resolve(err);
        });
    });
}

beforeAll(async () => {
    await FsUtilities.rm(testVersionsDir);
    // empty rather than absent: a project that has not recorded a version yet still has the folder,
    // because that is what the application takes as permission to write the first snapshot
    await FsUtilities.mkdir(testVersionsDir);
    server = await startTestServer({
        version: '1.0.0',
        providers: [
            ...defaultTestServerProviders,
            // the real service, writing where this file can seed and read what it wrote
            { token: ZIBRI_DI_TOKENS.VERSIONS_PATH, useValue: testVersionsDir }
        ],
        websocketControllers: [VersionResolveController, VersionedDispatchController]
    });
    baseUrl = await server.start();
}, 30000);

afterAll(async () => {
    await server.shutdown();
}, 15000);

describe('VersioningService websocket integration', () => {
    describe('resolveVersion via websocket', () => {
        beforeEach(async () => {
            await FsUtilities.rm(testVersionsDir);
            await writeVersionFile({
                value: '1.0.0',
                startsAt: new Date('2024-01-01'),
                endsAt: new Date('2024-02-01'),
                routes: []
            });
            await writeVersionFile({
                value: '2.0.0',
                startsAt: new Date('2024-02-01'),
                routes: []
            });
            await writeVersionFile({
                value: '3.0.0',
                startsAt: new Date('2024-01-01'),
                endsAt: new Date('2024-01-15'),
                routes: []
            });
            await restartServer({ version: '2.0.0', websocketControllers: [VersionResolveController, VersionedDispatchController] });
        });

        it('resolves latest version when no header provided', async () => {
            const msg: WebsocketMessage = await sendWsEvent(baseUrl, 'resolve-version');
            expect(msg.ok).toBe(true);
            // eslint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-member-access
            expect((msg as any).data.value).toBe('2.0.0');
            // eslint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-member-access
            expect((msg as any).data.endsAt).toBeUndefined();
        });

        it('resolves specific version by header', async () => {
            const msg: WebsocketMessage = await sendWsEvent(baseUrl, 'resolve-version', {}, '1.0.0');
            expect(msg.ok).toBe(true);
            // eslint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-member-access
            expect((msg as any).data.value).toBe('1.0.0');
        });

        it('returns error for unknown version', async () => {
            const err: Error = await expectWsConnectError(baseUrl, '9.9.9');
            expect(err.message).toContain('Version "9.9.9" not found');
        });
    });

    describe('Version-based event dispatch', () => {
        beforeEach(async () => {
            await FsUtilities.rm(testVersionsDir);
            await writeVersionFile({
                value: '1.0.0',
                startsAt: new Date('2024-01-01'),
                endsAt: new Date('2024-02-01'),
                routes: []
            });
            await writeVersionFile({
                value: '2.0.0',
                startsAt: new Date('2024-02-01'),
                routes: []
            });
            await writeVersionFile({
                value: '3.0.0',
                startsAt: new Date('2024-01-01'),
                endsAt: new Date('2024-01-15'),
                routes: []
            });
            await restartServer({ version: '2.0.0', websocketControllers: [VersionedDispatchController] });
        });

        // --- dispatch:event ---
        it('uses latest handler when no version header (active version)', async () => {
            const msg: WebsocketMessage = await sendWsEvent(baseUrl, 'dispatch:latest-only');
            expect(msg.ok).toBe(true);
            // eslint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-member-access
            expect((msg as any).data.handler).toBe('latest');
        });

        it('uses latest handler when explicitly requesting active version 2.0.0', async () => {
            const msg: WebsocketMessage = await sendWsEvent(baseUrl, 'dispatch:latest-only', {}, '2.0.0');
            expect(msg.ok).toBe(true);
            // eslint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-member-access
            expect((msg as any).data.handler).toBe('latest');
        });

        it('returns 404 when requesting older version on a latest-only route', async () => {
            const msg: WebsocketMessage = await sendWsEvent(baseUrl, 'dispatch:latest-only', {}, '1.0.0');
            expect(msg.ok).toBe(false);
            expect(msg.status).toBe(404);
        });

        it('uses v1 handler when requesting 1.0.0 explicitly', async () => {
            const msg: WebsocketMessage = await sendWsEvent(baseUrl, 'dispatch:event', {}, '1.0.0');
            expect(msg.ok).toBe(true);
            // eslint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-member-access
            expect((msg as any).data.handler).toBe('v1');
        });

        it('uses v2 handler when requesting 2.0.0 explicitly', async () => {
            const msg: WebsocketMessage = await sendWsEvent(baseUrl, 'dispatch:event', {}, '2.0.0');
            expect(msg.ok).toBe(true);
            // eslint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-member-access
            expect((msg as any).data.handler).toBe('v2');
        });

        it('returns not found error for version with no handler', async () => {
            const msg: WebsocketMessage = await sendWsEvent(baseUrl, 'dispatch:event', {}, '3.0.0');
            expect(msg.ok).toBe(false);
            expect(msg.status).toBe(404);
        });

        it('returns 400 error for unknown version', async () => {
            const err: Error = await expectWsConnectError(baseUrl, '4.0.0');
            expect(err.message).toContain('Version "4.0.0" not found');
        });

        // --- dispatch:only-all ---
        it('uses all handler for any valid version', async () => {
            const msg: WebsocketMessage = await sendWsEvent(baseUrl, 'dispatch:only-all', {}, '1.0.0');
            expect(msg.ok).toBe(true);
            // eslint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-member-access
            expect((msg as any).data.handler).toBe('all');
        });

        it('uses all handler when no version header', async () => {
            const msg: WebsocketMessage = await sendWsEvent(baseUrl, 'dispatch:only-all');
            expect(msg.ok).toBe(true);
            // eslint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-member-access
            expect((msg as any).data.handler).toBe('all');
        });

        // --- dispatch:only-v1 ---
        it('returns not found for active version on v1-only event', async () => {
            const msg: WebsocketMessage = await sendWsEvent(baseUrl, 'dispatch:only-v1');
            expect(msg.ok).toBe(false);
            expect(msg.status).toBe(404);
        });

        it('serves v1 handler when requesting 1.0.0 on v1-only event', async () => {
            const msg: WebsocketMessage = await sendWsEvent(baseUrl, 'dispatch:only-v1', {}, '1.0.0');
            expect(msg.ok).toBe(true);
            // eslint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-member-access
            expect((msg as any).data.handler).toBe('v1');
        });
    });

    describe('Validation: overlap between latest and active version', () => {
        @WebsocketController({ allowOrphan: true, eventPrefix: 'overlap:' })
        class OverlapWebsocketController {
            @WebsocketRoute('event', { versions: ['latest'] })
            latest(): { handler: string } {
                return { handler: 'latest' };
            }

            @WebsocketRoute('event', { versions: ['2.0.0'] })
            v2(): { handler: string } {
                return { handler: 'v2' };
            }
        }

        beforeEach(async () => {
            await FsUtilities.rm(testVersionsDir);
            await writeVersionFile({
                value: '2.0.0',
                startsAt: new Date('2024-02-01'),
                routes: []
            });
        });

        it('throws if latest overlaps with the current active version', async () => {
            await expect(
                restartServer({
                    version: '2.0.0',
                    websocketControllers: [OverlapWebsocketController]
                })
            ).rejects.toThrow(/defined more than once/);
        });
    });
});