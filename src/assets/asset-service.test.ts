
import { beforeEach, describe, expect, it } from '@jest/globals';

import { TreeNode } from './asset.service';
import { inject, ZIBRI_DI_TOKENS } from '../di';
import { AssetServiceInterface } from './asset-service.interface';
import { FsUtilities, Path } from '../utilities';

describe('AssetService', () => {
    let assetService: AssetServiceInterface;

    beforeEach(() => {
        assetService = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);
    });

    describe('buildFileTree', () => {
        it('should build a file tree for a given directory', async () => {
            const mockDirPath: Path = FsUtilities.getPath(__dirname, '..', '__testing__', 'mocks', 'tree');
            (assetService.publicAssetsPath as unknown as Path) = mockDirPath;
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