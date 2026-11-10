import { FileToGenerate, generateEntityFilesForProvider, GenerateEntityFilesForProviderResult } from './generate-entity-files-for-provider.function';
import { EntityGenerationProvider } from './providers/entity-generation-provider.interface';
import { initDiContainer } from '../../di/init-di-container.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { ConsoleUtilities } from '../../logging/console.utilities';
import { FsUtilities, FsPath } from '../../utilities/fs.utilities';
import { registerTsNode } from '../../utilities/register-ts-node.function';

/**
 * Resolves providers from the src/models/generated/providers.ts file and generates entities from them.
 * @param root - The root of the project. Defaults to the working directory.
 */
export async function generateEntityFiles(root: string = process.cwd()): Promise<void> {
    initDiContainer();

    const cwd: string = root;
    const providersPath: FsPath | undefined = await findProvidersPath(cwd);
    if (providersPath == undefined) {
        // said rather than kept quiet, as a build started from the wrong folder finds no file either
        ConsoleUtilities.info(`There is no src/models/generated/providers.ts, so no entities are generated, in ${cwd}.`);
        return;
    }
    const ext: string = FsUtilities.extensionName(providersPath).toLowerCase();
    // what this generates is TypeScript source, into the source tree. Resolving to any other
    // extension means the providers file being looked at is build output, where the entities this
    // would generate already exist - so there is nothing to do rather than something to refuse.
    if (ext !== '.ts') {
        return;
    }
    // Register ts-node so the dynamically required providers file can be loaded when it is authored
    // in TypeScript. Below the guard above rather than at the top of the file, so an application
    // that only ever imports `zibri` never resolves a compiler it has no use for.
    registerTsNode(`The providers file ${providersPath}`);
    // eslint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-assignment, typescript/no-require-imports, typescript/no-var-requires
    const imported: any = require(providersPath);
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

/**
 * Finds the file naming the providers of the entities to generate.
 * @param cwd - The root of the project.
 * @returns The file, or undefined when the project has none.
 */
async function findProvidersPath(cwd: string): Promise<FsPath | undefined> {
    const candidates: FsPath[] = [
        FsUtilities.getPath(cwd, 'src/models/generated/providers.js'),
        FsUtilities.getPath(cwd, 'src/models/generated/providers.cjs'),
        FsUtilities.getPath(cwd, 'src/models/generated/providers.mjs'),
        FsUtilities.getPath(cwd, 'src/models/generated/providers.ts')
    ];
    const found: boolean[] = await Promise.all(candidates.map(async candidate => await FsUtilities.exists(candidate)));
    return candidates.find((_, index) => found[index] === true);
}