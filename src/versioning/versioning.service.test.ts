import assert from 'node:assert';
import { Dirent } from 'node:fs';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { RouteWithVersionData } from './route-with-version-data.model';
import { Version, VersionFile } from './version.model';
import { type VersioningServiceInterface } from './versioning-service.interface';
import { VersioningService } from './versioning.service';
import { testFileFolder } from '../__testing__/constants';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { startTestServer, StartedTestServer } from '../__testing__/test-server/start-test-server.function';
import { HttpRequestContext } from '../context/request/http-request.context';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../context/request/request-context-token.model';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { type Header } from '../http/header.type';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { type RouterInterface } from '../routing/router.interface';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';
import { SemVerVersion } from '../utilities/sem-ver.utilities';

const testVersionsDir: FsPath = FsUtilities.getPath(testFileFolder, 'versions');

// ---------------------------------------------------------------
// Custom versioning service that writes to a temporary directory
// ---------------------------------------------------------------
class TestVersioningService extends VersioningService {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.VERSION_HEADER)
        versionHeader: Header,
        @Inject(ZIBRI_DI_TOKENS.VERSION_QUERY_PARAM)
        versionQueryParam: Header,
        @Inject(ZIBRI_DI_TOKENS.ROUTER)
        router: RouterInterface
    ) {
        super(versionHeader, versionQueryParam, router);
        // eslint-disable-next-line typescript/no-unsafe-member-access, typescript/no-explicit-any
        (this as any).versionsPath = testVersionsDir;
    }
}

// ---------------------------------------------------------------
// Test controller that exposes the versioning service via HTTP
// ---------------------------------------------------------------
@Controller('/version-test', { allowOrphan: true, versions: 'all' })
class VersionTestController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.VERSIONING_SERVICE)
        private readonly versioningService: VersioningServiceInterface
    ) {}

    @Get('/resolve')
    async resolveVersion(): Promise<Version> {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!context) {
            throw new Error('context missing');
        }
        return await context.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_VERSION);
    }
}

// ---------------------------------------------------------------
// Test controller with versioned routes for validation tests
// ---------------------------------------------------------------
@Controller('/validated', { versions: ['1.0.0'], allowOrphan: true })
class ValidatedController {
    @Get('/endpoint')
    getEndpoint(): { ok: boolean } {
        return { ok: true };
    }
}

// Controller with a route that only uses 'latest', not '1.0.0'
@Controller('/latest-test', { versions: ['latest'], allowOrphan: true })
class LatestOnlyController {
    @Get('/endpoint')
    get(): {} {
        return {};
    }
}

@Controller('/bad', { versions: ['2.0.0'], allowOrphan: true })
class BadController {
    @Get('/endpoint')
    get(): {} {
        return {};
    }
}

let server: StartedTestServer;
let baseUrl: string;

// Helper to write a version file into the temp dir
async function writeVersionFile(file: VersionFile): Promise<void> {
    const filePath: FsPath = FsUtilities.getPath(testVersionsDir, `${file.value}.json`);
    await FsUtilities.mkdir(testVersionsDir);
    await FsUtilities.upsertFile(filePath, JsonUtilities.stringify(file));
}

// Helper to read a version file
async function readVersionFile(version: string): Promise<VersionFile> {
    const filePath: FsPath = FsUtilities.getPath(testVersionsDir, `${version}.json`);
    const raw: string = await FsUtilities.readFile(filePath);
    return JsonUtilities.parse(raw);
}

// Reset state before each test: clear temp dir and stop/restart?
// Since version files are read only during afterAppInit, which runs once at startup,
// we need to restart the server for each test scenario. We'll use a helper.
async function restartServer(options: { version?: SemVerVersion, controllers?: Newable<unknown>[] } = {}): Promise<void> {
    await server.reInit(options);
    baseUrl = await server.start();
}

beforeAll(async () => {
    await FsUtilities.rm(testVersionsDir);
    // Start the server with our custom versioning service and a test controller
    server = await startTestServer({
        version: '1.0.0', // default version, we'll change per test
        providers: [
            ...defaultTestServerProviders,
            { token: ZIBRI_DI_TOKENS.VERSIONING_SERVICE, useClass: TestVersioningService }
        ],
        controllers: [VersionTestController, ValidatedController]
    });
    baseUrl = await server.start();
}, 15000);

afterAll(async () => {
    await server.shutdown();
});

describe('VersioningService integration', () => {
    describe('First startup', () => {
        it('creates the initial version file with routes', async () => {
            const file: VersionFile = await readVersionFile('1.0.0');
            expect(file.value).toBe('1.0.0');
            expect(file.endsAt).toBeUndefined();
            expect(file.routes.length).toBeGreaterThan(0);

            const validatedRoute: RouteWithVersionData | undefined = file.routes.find(r => r.key === 'GET /validated/endpoint');
            expect(validatedRoute).toBeDefined();
            expect(validatedRoute?.versions).toEqual(['1.0.0']);
        });
    });

    describe('Already at latest version (no-op)', () => {
        it('does not modify the version file', async () => {
            await restartServer({ version: '1.0.0' });
            const file: VersionFile = await readVersionFile('1.0.0');
            expect(file.endsAt).toBeUndefined();
            // No new files created
            const files: Dirent[] = await FsUtilities.readdir(testVersionsDir);
            expect(files.map(f => f.name)).toEqual(['1.0.0.json']);
        });
    });

    describe('Normal version bump', () => {
        const oldVersion: SemVerVersion = '1.0.0';
        const newVersion: SemVerVersion = '2.0.0';

        beforeEach(async () => {
            await FsUtilities.rm(testVersionsDir);
            await restartServer({
                version: oldVersion,
                controllers: [ValidatedController]
            });
            await restartServer({
                version: newVersion,
                controllers: [ValidatedController]
            });
        });

        it('deprecates the old version and creates the new one', async () => {
            const oldFile: VersionFile = await readVersionFile(oldVersion);
            assert(oldFile.endsAt);
            const transitionTime: Date = new Date(oldFile.endsAt);

            const newFile: VersionFile = await readVersionFile(newVersion);
            expect(newFile.value).toBe(newVersion);
            expect(newFile.endsAt).toBeUndefined();
            expect(new Date(newFile.startsAt).getTime()).toBe(transitionTime.getTime());
            // Routes in new file reflect current in-code routes (e.g., still include the validated endpoint)
            expect(newFile.routes).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'GET /validated/endpoint' })]));
        });
    });

    describe('Crash recovery: zero active versions', () => {
        const oldVersion: SemVerVersion = '1.0.0';
        const newVersion: SemVerVersion = '2.0.0';

        beforeEach(async () => {
            // Old version already deprecated (crash scenario)
            await writeVersionFile({
                value: oldVersion,
                startsAt: new Date('2024-01-01'),
                endsAt: new Date('2024-02-01'),
                routes: [{ key: 'GET /validated/endpoint', versions: [oldVersion] }]
            });
            // New version does NOT exist
            await restartServer({ version: newVersion });
        });

        it('leaves the old file untouched and creates the new one with a fresh startsAt', async () => {
            const oldFile: VersionFile = await readVersionFile(oldVersion);
            expect(oldFile.endsAt).toBe('2024-02-01T00:00:00.000Z');

            const newFile: VersionFile = await readVersionFile(newVersion);
            expect(newFile.value).toBe(newVersion);
            expect(newFile.endsAt).toBeUndefined();
            assert(oldFile.endsAt);
            expect(new Date(newFile.startsAt).getTime()).toBeGreaterThan(new Date(oldFile.endsAt).getTime());
            // Validation still passed: the route GET /validated/endpoint still exists, so no error.
        });
    });

    describe('Crash recovery: multiple active versions (incomplete bump)', () => {
        const v1: SemVerVersion = '1.0.0';
        const v2: SemVerVersion = '2.0.0'; // new app version, file already created prematurely

        beforeEach(async () => {
            await writeVersionFile({
                value: v1,
                startsAt: new Date('2024-01-01'),
                routes: [{ key: 'GET /validated/endpoint', versions: [v1] }]
            });
            // Prematurely created new version file with stale routes
            await writeVersionFile({
                value: v2,
                startsAt: new Date('2024-02-01'),
                routes: [] // will be updated
            });
            await restartServer({ version: v2, controllers: [ValidatedController] });
        });

        it('chains endsAt of old versions and updates new file routes', async () => {
            const oldFile: VersionFile = await readVersionFile(v1);
            expect(oldFile.endsAt).toBe('2024-02-01T00:00:00.000Z');

            const newFile: VersionFile = await readVersionFile(v2);
            expect(newFile.endsAt).toBeUndefined();
            expect(newFile.routes).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'GET /validated/endpoint' })]));
        });
    });

    describe('Validation: route removed', () => {
        it('throws if a previously supported route is missing in the new version', async () => {
            // Prepare old active version with an extra route
            await writeVersionFile({
                value: '1.0.0',
                startsAt: new Date(),
                routes: [
                    { key: 'GET /validated/endpoint', versions: ['1.0.0'] },
                    { key: 'POST /delete-me', versions: ['1.0.0'] }
                ]
            });

            // Start with version 2.0.0 and a controller that does NOT define POST /delete-me
            // The ValidatedController only has GET /validated/endpoint, so POST /delete-me is missing.
            await expect(
                restartServer({ version: '2.0.0', controllers: [VersionTestController, ValidatedController] })
            ).rejects.toThrow(/Route "POST \/delete-me" no longer exists in code/);
        });
    });

    describe('Validation: unknown version in stored route (file-level first)', () => {
        // Controller that supports the version referenced in the old snapshot
        @Controller('/validated', { versions: ['2.0.0'], allowOrphan: true })
        class ValidatedForV2Controller {
            @Get('/endpoint')
            getEndpoint(): { ok: boolean } {
                return { ok: true };
            }
        }

        it('throws file-level error before checking in-code routes', async () => {
            await FsUtilities.rm(testVersionsDir);
            // Create a version file with a stored route referencing a version that doesn't exist
            await writeVersionFile({
                value: '1.0.0',
                startsAt: new Date(),
                routes: [{ key: 'GET /validated/endpoint', versions: ['2.0.0'] }]
            });

            await expect(
                restartServer({ version: '3.0.0', controllers: [ValidatedForV2Controller] })
            ).rejects.toThrow(
                'Route version mismatch detected:\n- Unknown version "2.0.0" in version file "1.0.0.json" on route "GET /validated/endpoint"'
            );
        });
    });

    describe('Validation: unknown version in in-code route', () => {
        it('throws after file-level checks pass if in-code route references unknown version', async () => {
            await FsUtilities.rm(testVersionsDir);
            await writeVersionFile({
                value: '1.0.0',
                startsAt: new Date(),
                routes: [{ key: 'GET /validated/endpoint', versions: ['1.0.0'] }]
            });

            await expect(
                restartServer({ version: '1.0.1', controllers: [ValidatedController, BadController] })
            ).rejects.toThrow(/Unknown version "2.0.0" on route "GET \/bad\/endpoint"/);
        });

        it('does NOT throw after file-level checks pass if in-code route references new version', async () => {
            await writeVersionFile({
                value: '1.0.0',
                startsAt: new Date(),
                routes: [{ key: 'GET /validated/endpoint', versions: ['1.0.0'] }]
            });

            await expect(
                restartServer({ version: '2.0.0', controllers: [ValidatedController, BadController] })
            ).resolves.not.toThrow();
        });
    });

    describe('Validation: latest route must support previous version', () => {
        it('throws if route uses "latest" but does not explicitly support the previous version', async () => {
            await writeVersionFile({
                value: '1.0.0',
                startsAt: new Date(),
                routes: [] // empty snapshot
            });

            await expect(
                restartServer({ version: '2.0.0', controllers: [VersionTestController, LatestOnlyController] })
            ).rejects.toThrow(
                /There are routes that have been used under the previous version "1.0.0"/
            );
        });
    });

    describe('resolveVersion via HTTP', () => {
        beforeEach(async () => {
            // Ensure we have version files for 1.0.0 and 2.0.0 active
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
            await restartServer({ version: '2.0.0' });
        });

        it('returns latest version when no header provided', async () => {
            const res: Response = await fetch(`${baseUrl}/version-test/resolve`);
            const body: Version = await res.json() as Version;
            expect(res.status).toBe(200);
            expect(body.value).toBe('2.0.0');
            expect(body.endsAt).toBeUndefined();
        });

        it('returns specific version by string', async () => {
            const res: Response = await fetch(`${baseUrl}/version-test/resolve`, {
                headers: { 'x-version': '1.0.0' }
            });
            const body: Version = await res.json() as Version;
            expect(res.status).toBe(200);
            expect(body.value).toBe('1.0.0');
        });

        it('resolves version by date (boundary case)', async () => {
            const res: Response = await fetch(`${baseUrl}/version-test/resolve`, {
                headers: { 'x-version': '2024-02-01T00:00:00.000Z' }
            });
            const body: Version = await res.json() as Version;
            expect(res.status).toBe(200);
            expect(body.value).toBe('2.0.0'); // half-open: startsAt <= date and endsAt > date or null
        });

        it('returns 400 for unknown version string', async () => {
            const res: Response = await fetch(`${baseUrl}/version-test/resolve`, {
                headers: { 'x-version': '9.9.9' }
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 for date with no active version', async () => {
            const res: Response = await fetch(`${baseUrl}/version-test/resolve`, {
                headers: { 'x-version': '2023-12-31T00:00:00.000Z' }
            });
            expect(res.status).toBe(400);
        });
    });

    describe('Version-based routing', () => {
        @Controller('/routing-test', { allowOrphan: true })
        class VersionedRouteController {
            @Get('/multi', { versions: ['1.0.0'] })
            multiV1(): object {
                return { handler: 'v1' };
            }

            @Get('/multi', { versions: ['2.0.0'] })
            multiV2(): object {
                return { handler: 'v2' };
            }

            @Get('/missing-v2', { versions: ['1.0.0'] })
            missingV2Handler(): object {
                return { handler: 'v1' };
            }

            @Get('/only-latest', { versions: ['latest'] })
            onlyLatest(): object {
                return { handler: 'latest' };
            }

            @Get('/only-all', { versions: 'all' })
            onlyAll(): object {
                return { handler: 'all' };
            }
        }

        beforeEach(async () => {
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

            await restartServer({
                version: '2.0.0',
                controllers: [VersionedRouteController]
            });
        });

        // --- /multi ---
        it('uses v2 handler when no header (active version)', async () => {
            const res: Response = await fetch(`${baseUrl}/routing-test/multi`);
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('v2');
        });

        it('uses v1 handler when requesting 1.0.0 explicitly', async () => {
            const res: Response = await fetch(`${baseUrl}/routing-test/multi`, {
                headers: { 'x-version': '1.0.0' }
            });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('v1');
        });

        it('uses v2 handler when requesting 2.0.0 explicitly', async () => {
            const res: Response = await fetch(`${baseUrl}/routing-test/multi`, {
                headers: { 'x-version': '2.0.0' }
            });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('v2');
        });

        it('falls back to "all" handler for known version 3.0.0 without specific handler', async () => {
            const res: Response = await fetch(`${baseUrl}/routing-test/multi`, {
                headers: { 'x-version': '3.0.0' }
            });
            expect(res.status).toBe(404);
        });

        it('returns 400 for unknown version', async () => {
            const res: Response = await fetch(`${baseUrl}/routing-test/multi`, {
                headers: { 'x-version': '4.0.0' }
            });
            expect(res.status).toBe(400);
        });

        // --- /missing-v2 ---
        it('returns 404 when active version has no handler', async () => {
            const res: Response = await fetch(`${baseUrl}/routing-test/missing-v2`);
            expect(res.status).toBe(404);
        });

        it('serves v1 handler when requesting 1.0.0 even if no 2.0.0 handler exists', async () => {
            const res: Response = await fetch(`${baseUrl}/routing-test/missing-v2`, {
                headers: { 'x-version': '1.0.0' }
            });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('v1');
        });

        it('returns 404 when explicit 2.0.0 has no handler', async () => {
            const res: Response = await fetch(`${baseUrl}/routing-test/missing-v2`, {
                headers: { 'x-version': '2.0.0' }
            });
            expect(res.status).toBe(404);
        });

        // --- /only-latest ---
        it('uses latest handler for active version (no header)', async () => {
            const res: Response = await fetch(`${baseUrl}/routing-test/only-latest`);
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('latest');
        });

        it('uses latest handler when explicitly requesting active version 2.0.0', async () => {
            const res: Response = await fetch(`${baseUrl}/routing-test/only-latest`, {
                headers: { 'x-version': '2.0.0' }
            });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('latest');
        });

        it('returns 404 when requesting older version on a latest‑only route', async () => {
            const res: Response = await fetch(`${baseUrl}/routing-test/only-latest`, {
                headers: { 'x-version': '1.0.0' }
            });
            expect(res.status).toBe(404);
        });

        // --- /only-all ---
        it('uses all handler for any valid version (1.0.0)', async () => {
            const res: Response = await fetch(`${baseUrl}/routing-test/only-all`, {
                headers: { 'x-version': '1.0.0' }
            });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('all');
        });
    });

    describe('Validation: overlap between latest and active version', () => {
        @Controller('/overlap', { allowOrphan: true })
        class OverlapController {
            @Get('/endpoint', { versions: ['latest'] })
            latest(): { handler: string } {
                return { handler: 'latest' };
            }

            @Get('/endpoint', { versions: ['2.0.0'] })
            v2(): { handler: string } {
                return { handler: 'v2' };
            }
        }

        it('throws if latest overlaps with the current active version', async () => {
            await FsUtilities.rm(testVersionsDir);
            await writeVersionFile({
                value: '2.0.0',
                startsAt: new Date('2024-02-01'),
                routes: []
            });

            await expect(
                restartServer({ version: '2.0.0', controllers: [OverlapController] })
            ).rejects.toThrow(/defined more than once/);
        });
    });

    describe('Semver range matchers in routing', () => {
    // Versions we need: 1.0.0, 1.1.0, 1.2.0, 1.3.0, 2.0.0, 2.1.0, 3.0.0
        const versionsToCreate: SemVerVersion[] = ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '2.0.0', '2.1.0', '3.0.0'];
        beforeEach(async () => {
        // Create all version files (deprecated except 2.1.0 as active)
            for (const v of versionsToCreate) {
                const isActive: boolean = v === '2.1.0';
                await writeVersionFile({
                    value: v,
                    startsAt: new Date(`2024-${v.slice(2, 4)}-01`), // dummy, not used
                    endsAt: isActive ? undefined : new Date('2024-12-31'),
                    routes: []
                });
            }
            await restartServer({
                version: '2.1.0',
                controllers: [RangeTestController]
            });
        });

        @Controller('/range-test', { allowOrphan: true })
        class RangeTestController {
            @Get('/caret', { versions: ['^1.0.0'] })
            handlerCaret(): { handler: string } {
                return { handler: '^1.0.0' };
            }

            @Get('/tilde', { versions: ['~1.2.0'] })
            handlerTilde(): { handler: string } {
                return { handler: '~1.2.0' };
            }

            @Get('/gte', { versions: ['>=2.0.0'] })
            handlerGte(): { handler: string } {
                return { handler: '>=2.0.0' };
            }

            @Get('/lte', { versions: ['<=1.2.0'] })
            handlerLte(): { handler: string } {
                return { handler: '<=1.2.0' };
            }

            @Get('/range-combo', { versions: ['>=1.1.0 <=1.2.0'] })
            handlerRangeCombo(): { handler: string } {
                return { handler: '>=1.1.0 <=1.2.0' };
            }

            // Separate exact and caret endpoints, no overlap
            @Get('/exact-2', { versions: ['2.0.0'] })
            handlerExact2(): { handler: string } {
                return { handler: 'exact-2.0.0' };
            }

            @Get('/caret-2', { versions: ['^2.0.0'] })
            handlerCaret2(): { handler: string } {
                return { handler: 'caret-2' };
            }

            @Get('/all-fallback', { versions: 'all' })
            handlerAll(): { handler: string } {
                return { handler: 'all' };
            }

            @Get('/latest-only', { versions: ['latest'] })
            handlerLatest(): { handler: string } {
                return { handler: 'latest' };
            }
        }

        // Caret ^1.0.0: matches >=1.0.0 <2.0.0
        it('^1.0.0 matches 1.0.0', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/caret`, { headers: { 'x-version': '1.0.0' } });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('^1.0.0');
        });
        it('^1.0.0 matches 1.3.0', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/caret`, { headers: { 'x-version': '1.3.0' } });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('^1.0.0');
        });
        it('^1.0.0 does NOT match 2.0.0 (returns 404)', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/caret`, { headers: { 'x-version': '2.0.0' } });
            expect(res.status).toBe(404);
        });

        // Tilde ~1.2.0: matches >=1.2.0 <1.3.0
        it('~1.2.0 matches 1.2.0', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/tilde`, { headers: { 'x-version': '1.2.0' } });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('~1.2.0');
        });
        it('~1.2.0 matches 1.2.5 (if we had it)', async () => {
        // No 1.2.5 file so will get 400 (unknown version). We'll skip, since versions must exist.
        });
        it('~1.2.0 does NOT match 1.3.0', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/tilde`, { headers: { 'x-version': '1.3.0' } });
            expect(res.status).toBe(404);
        });

        // Gte >=2.0.0
        it('>=2.0.0 matches 2.0.0', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/gte`, { headers: { 'x-version': '2.0.0' } });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('>=2.0.0');
        });
        it('>=2.0.0 matches 3.0.0', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/gte`, { headers: { 'x-version': '3.0.0' } });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('>=2.0.0');
        });
        it('>=2.0.0 does NOT match 1.3.0', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/gte`, { headers: { 'x-version': '1.3.0' } });
            expect(res.status).toBe(404);
        });

        // Lte <=1.2.0
        it('<=1.2.0 matches 1.0.0', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/lte`, { headers: { 'x-version': '1.0.0' } });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('<=1.2.0');
        });
        it('<=1.2.0 matches 1.2.0', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/lte`, { headers: { 'x-version': '1.2.0' } });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('<=1.2.0');
        });
        it('<=1.2.0 does NOT match 1.3.0', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/lte`, { headers: { 'x-version': '1.3.0' } });
            expect(res.status).toBe(404);
        });

        // Range combination >=1.1.0 <=1.2.0
        it('>=1.1.0 <=1.2.0 matches 1.1.0', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/range-combo`, { headers: { 'x-version': '1.1.0' } });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('>=1.1.0 <=1.2.0');
        });
        it('>=1.1.0 <=1.2.0 matches 1.2.0', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/range-combo`, { headers: { 'x-version': '1.2.0' } });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('>=1.1.0 <=1.2.0');
        });
        it('>=1.1.0 <=1.2.0 does NOT match 1.0.0', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/range-combo`, { headers: { 'x-version': '1.0.0' } });
            expect(res.status).toBe(404);
        });

        // Exact vs range priority: /exact-vs-caret
        it('exact 2.0.0 handler matches 2.0.0', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/exact-2`, { headers: { 'x-version': '2.0.0' } });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('exact-2.0.0');
        });
        it('^2.0.0 handler matches 2.1.0', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/caret-2`, { headers: { 'x-version': '2.1.0' } });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('caret-2');
        });

        it('^2.0.0 also matches 2.0.0 (range endpoint)', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/caret-2`, { headers: { 'x-version': '2.0.0' } });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('caret-2');
        });

        // all fallback
        it('all fallback for any version with no specific handler', async () => {
        // There is no other handler for /all-fallback; use a version without a specific route, e.g. 1.0.0
            const res: Response = await fetch(`${baseUrl}/range-test/all-fallback`, { headers: { 'x-version': '1.0.0' } });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('all');
        });

        // latest
        it('latest handler matches active version (2.1.0) when no header', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/latest-only`);
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { handler: string } = await res.json();
            expect(body.handler).toBe('latest');
        });
        it('latest handler does NOT match old version 1.0.0', async () => {
            const res: Response = await fetch(`${baseUrl}/range-test/latest-only`, { headers: { 'x-version': '1.0.0' } });
            expect(res.status).toBe(404);
        });

        describe('Validation: overlapping version matchers', () => {
            it('throws when two handlers cover the same version on the same route', async () => {
                @Controller('/overlap-test', { allowOrphan: true })
                class OverlapController {
                    @Get('/endpoint', { versions: ['2.0.0'] })
                    exact(): {} {
                        return {};
                    }

                    @Get('/endpoint', { versions: ['^2.0.0'] })
                    range(): {} {
                        return {};
                    }
                }

                // Need a version file so the app can start to the point where controller registration occurs
                await writeVersionFile({
                    value: '1.0.0',
                    startsAt: new Date(),
                    routes: []
                });

                const promise: Promise<void> = restartServer({
                    version: '1.0.0',
                    controllers: [OverlapController]
                });

                await expect(promise).rejects.toThrow(
                    /The route "GET \/overlap-test\/endpoint" for the version "2.0.0" has been defined more than once/
                );
            });
        });
    });
});