import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { AssetServiceInterface } from './asset-service.interface';
import { TreeNode } from './asset.service';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { initDiContainer } from '../di/init-di-container.function';
import { inject } from '../di/inject.function';
import { FsUtilities, FsPath } from '../utilities/fs.utilities';

describe('AssetService', () => {
    let assetService: AssetServiceInterface;

    beforeAll(() => {
        initDiContainer();
    });

    beforeEach(() => {
        assetService = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);
    });

    describe('buildFileTree', () => {
        it('should build a file tree for a given directory', async () => {
            const mockDirPath: FsPath = FsUtilities.getPath(__dirname, '..', '__testing__', 'mocks', 'tree');
            (assetService.publicAssetsPath as unknown as FsPath) = mockDirPath;
            const expectedTree: TreeNode[] = [
                // Mocked file tree structure
                { name: 'file1.txt', type: 'file', route: '/assets/file1.txt' },
                { name: 'subdir', type: 'directory', children: [{ name: 'file2.txt', type: 'file', route: '/assets/subdir/file2.txt' }] }
            ];

            const fileTree: TreeNode[] = await assetService.buildFileTree();
            expect(fileTree).toEqual(expectedTree);
        });
    });

    describe('onAppInit', () => {
        // AssetService.publicAssetsPath is a readonly field computed from its own module directory
        // (src/assets/assets/public), so exercising the real static middleware and favicon route
        // registered by onAppInit requires real fixture files to exist at that exact real path.
        const publicAssetsPath: FsPath = FsUtilities.getPath(__dirname, 'assets', 'public');
        let server: StartedTestServer;
        let baseUrl: string;

        beforeAll(async () => {
            await FsUtilities.mkdir(publicAssetsPath);
            server = await startTestServer();
            baseUrl = await server.start();
        }, 15000);

        afterAll(async () => {
            await server?.shutdown();
            await FsUtilities.rm(FsUtilities.getPath(__dirname, 'assets'));
        }, 15000);

        it('responds with 404 NotFoundError, not a 500, when favicon.png was not provided by the project', async () => {
            const res: Response = await fetch(`${baseUrl}/favicon.ico`);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { name?: string } = await res.json();
            expect(res.status).toBe(404);
            expect(body.name).toBe('NotFoundError');
        });

        it('serves files placed in the public assets folder under /assets', async () => {
            await FsUtilities.createFile(FsUtilities.getPath(publicAssetsPath, 'greeting.txt'), 'hello from assets');

            const res: Response = await fetch(`${baseUrl}/assets/greeting.txt`);
            expect(res.status).toBe(200);
            await expect(res.text()).resolves.toBe('hello from assets');
        });

        it('serves favicon.png from the public assets folder once the project provides it', async () => {
            await FsUtilities.createFile(FsUtilities.getPath(publicAssetsPath, 'favicon.png'), 'fake-favicon-bytes');

            const res: Response = await fetch(`${baseUrl}/favicon.ico`);
            expect(res.status).toBe(200);
            await expect(res.text()).resolves.toBe('fake-favicon-bytes');
        });
    });
});