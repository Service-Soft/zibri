import { pathToFileURL } from 'node:url';

import { FileToGenerate, generateEntityFilesForProvider, GenerateEntityFilesForProviderResult } from './generate-entity-files-for-provider.function.ts';
import { EntityGenerationProvider } from './providers/entity-generation-provider.interface.ts';
import { initDiContainer } from '../../di/init-di-container.function.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { FsUtilities, FsPath } from '../../utilities/fs.utilities.ts';
import { TypeScriptLoaderUtilities } from '../../utilities/typescript-loader/typescript-loader.utilities.ts';

/**
 * Resolves providers from the src/models/generated/providers.ts file and generates entities from them.
 */
export async function generateEntityFiles(): Promise<void> {
    initDiContainer();

    const cwd: string = process.cwd();
    const providersPath: FsPath = await resolveProvidersPath(cwd);
    const ext: string = FsUtilities.extensionName(providersPath).toLowerCase();
    // what this generates is TypeScript source, into the source tree. Resolving to any other
    // extension means the providers file being looked at is build output, where the entities this
    // would generate already exist - so there is nothing to do rather than something to refuse.
    if (ext !== '.ts') {
        return;
    }
    // Register the loader so the providers file, which is TypeScript, can be imported. Below the
    // guard above rather than at the top of the file, so an application that only ever imports
    // `zibri` never resolves a compiler it has no use for.
    TypeScriptLoaderUtilities.register(`The providers file ${providersPath}`);
    // a file of the application, which a bundler of this package has nothing to resolve
    // eslint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-assignment
    const imported: any = await import(pathToFileURL(providersPath).href);
    // eslint-disable-next-line typescript/no-unsafe-member-access
    const providersRaw: unknown = (imported.providers ?? imported.default) as unknown;

    if (!Array.isArray(providersRaw)) {
        throw new InternalError(`Expected 'providers' (or default export) to be an array in ${providersPath}`);
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
        filesToGenerate.push({ path: FsUtilities.getPath(cwd, 'src/models/generated/index.ts'), lines: indexLines });
    }

    await Promise.all(filesToGenerate.map(async f => {
        await FsUtilities.upsertFile(f.path, f.lines.join('\n'));
    }));
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
async function resolveProvidersPath(cwd: string): Promise<FsPath> {
    const candidates: FsPath[] = [
        FsUtilities.getPath(cwd, 'src/models/generated/providers.js'),
        FsUtilities.getPath(cwd, 'src/models/generated/providers.cjs'),
        FsUtilities.getPath(cwd, 'src/models/generated/providers.mjs'),
        FsUtilities.getPath(cwd, 'src/models/generated/providers.ts')
    ];
    const providersPath: FsPath = await Promise.any(candidates.map(async p => {
        if (await FsUtilities.exists(p)) {
            return p;
        }
        throw new InternalError(`Could not locate ${p}`);
    }));
    return providersPath;
}