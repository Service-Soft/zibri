import { writeFile } from 'fs/promises';
import path from 'path';

import { register } from 'ts-node';

import { FileToGenerate, generateEntityFilesForProvider, GenerateEntityFilesForProviderResult } from './generate-entity-files-for-provider.function';
import { EntityGenerationProvider } from './providers/entity-generation-provider.interface';
import { pathExists } from '../../utilities';

/**
 * Resolves providers from the src/models/generated/providers.ts file and generates entities from them.
 */
export async function generateEntityFiles(): Promise<void> {
    const cwd: string = process.cwd();
    const providersPath: string = await resolveProvidersPath(cwd);
    const ext: string = path.extname(providersPath).toLowerCase();
    if (ext !== '.ts') {
        return;
    }
    register();
    // eslint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-assignment, typescript/no-require-imports, typescript/no-var-requires
    const imported: any = require(providersPath);
    // eslint-disable-next-line typescript/no-unsafe-member-access
    const providersRaw: unknown = (imported.providers ?? imported.default) as unknown;

    if (!Array.isArray(providersRaw)) {
        throw new Error(`Expected 'providers' (or default export) to be an array in ${providersPath}`);
    }

    const indexLines: string[] = [];
    const filesToGenerate: FileToGenerate[] = [];

    const providers: EntityGenerationProvider[] = providersRaw as EntityGenerationProvider[];
    for (const provider of providers) {
        const data: GenerateEntityFilesForProviderResult = await generateEntityFilesForProvider(provider, cwd);
        filesToGenerate.push(...data.filesToGenerate);
        indexLines.push(...data.indexLines);
    }

    if (indexLines.length) {
        filesToGenerate.push({ path: path.join(cwd, 'src/models/generated/index.ts'), lines: indexLines });
    }
    for (const f of filesToGenerate) {
        await writeFile(f.path, f.lines.join('\n'), 'utf8');
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function resolveProvidersPath(cwd: string): Promise<string> {
    const candidates: string[] = [
        path.join(cwd, 'src/models/generated/providers.js'),
        path.join(cwd, 'src/models/generated/providers.cjs'),
        path.join(cwd, 'src/models/generated/providers.mjs'),
        path.join(cwd, 'src/models/generated/providers.ts')
    ];
    const providersPath: string = await Promise.any(candidates.map(async p => {
        if (await pathExists(p)) {
            return p;
        }
        throw new Error(`Could not locate ${p}`);
    }));
    return providersPath;
}