
import { beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { AssetServiceInterface } from './asset-service.interface';
import { TreeNode } from './asset.service';
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
});