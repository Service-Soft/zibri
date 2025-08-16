import * as path from 'path';

import { beforeEach, describe, expect, it } from '@jest/globals';

import { AssetService, TreeNode } from './asset.service';
import { inject, ZIBRI_DI_TOKENS } from '../di';

describe('AssetService', () => {
    let assetService: AssetService;

    beforeEach(() => {
        assetService = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);
    });

    describe('buildFileTree', () => {
        it('should build a file tree for a given directory', async () => {
            const mockDirPath: string = path.join(__dirname, '..', '__testing__', 'mocks', 'tree');
            (assetService.publicAssetsPath as unknown as string) = mockDirPath;
            const expectedTree: TreeNode[] = [
                // Mocked file tree structure
                { name: 'file1.txt', type: 'file', route: '/assets/file1.txt' },
                { name: 'subdir', type: 'directory', children: [{ name: 'file2.txt', type: 'file', route: '/assets/subdir/file2.txt' }] }
            ];

            const fileTree: TreeNode[] = await assetService['buildFileTree']();
            expect(fileTree).toEqual(expectedTree);
        });
    });
});