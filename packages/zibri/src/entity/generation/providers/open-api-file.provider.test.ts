import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { OpenApiFileProvider } from './open-api-file.provider';
import { testFileFolder } from '../../../__testing__/constants';
import { OpenApiDefinition } from '../../../open-api/open-api.model';
import { FsPath, FsUtilities } from '../../../utilities/fs.utilities';
import { JsonUtilities } from '../../../utilities/json.utilities';

const workDir: FsPath = FsUtilities.getPath(testFileFolder, 'open-api-file-provider');

const v31Spec: OpenApiDefinition = {
    openapi: '3.1.0',
    info: { title: 'File Spec', version: '1.0.0' },
    paths: {},
    components: { schemas: {} }
};

describe('OpenApiFileProvider', () => {
    beforeAll(async () => {
        await FsUtilities.mkdir(workDir);
    });

    afterAll(async () => {
        await FsUtilities.rm(workDir);
    });

    it('exposes the constructor arguments, using the documented defaults', () => {
        const provider: OpenApiFileProvider = new OpenApiFileProvider('MyApi', FsUtilities.getPath(workDir, 'unused.json'));
        expect(provider.prefix).toBe('MyApi');
        expect(provider.generateSchemasFromPaths).toBe(false);
        expect(provider.markAsEntities).toBe(false);
    });

    it('reads a local v3.1 OpenAPI file and returns it unchanged', async () => {
        const filePath: FsPath = FsUtilities.getPath(workDir, 'v31-spec.json');
        await FsUtilities.createFile(filePath, JsonUtilities.stringify(v31Spec));

        const provider: OpenApiFileProvider = new OpenApiFileProvider('MyApi', filePath);
        const spec: OpenApiDefinition = await provider.resolveSpec();

        expect(spec).toEqual(v31Spec);
    });

    it('upgrades a local v3.0 OpenAPI file to v3.1', async () => {
        const filePath: FsPath = FsUtilities.getPath(workDir, 'v30-spec.json');
        const v30Spec: Record<string, unknown> = {
            openapi: '3.0.0',
            info: { title: 'File Spec', version: '1.0.0' },
            paths: {},
            components: { schemas: {} }
        };
        await FsUtilities.createFile(filePath, JsonUtilities.stringify(v30Spec));

        const provider: OpenApiFileProvider = new OpenApiFileProvider('MyApi', filePath);
        const spec: OpenApiDefinition = await provider.resolveSpec();

        expect(spec.openapi).toBe('3.1.0');
    });

    it('rejects a file containing an unsupported OpenAPI version', async () => {
        const filePath: FsPath = FsUtilities.getPath(workDir, 'unsupported-spec.json');
        await FsUtilities.createFile(filePath, JsonUtilities.stringify({ openapi: '4.0.0' }));

        const provider: OpenApiFileProvider = new OpenApiFileProvider('MyApi', filePath);
        await expect(provider.resolveSpec()).rejects.toThrow('Unsupported OpenAPI version');
    });
});