import { generateEntityFiles } from '../entity/generation/generate-entity-files.function';
import { generateHandlebarTypeFiles } from '../handlebars/generate-handlebar-type-files.function';
import { generateSourceXlf } from '../localization/xlf/generate-source-xlf.function';
import { FsUtilities } from '../utilities/fs.utilities';
import { resolveZibriRoot } from '../utilities/resolve-zibri-root.function';

/**
 * The part of webpack's compiler the plugin uses. Typed structurally, like the plugins of
 * `zibri-tsx-compiler/webpack`, so a compiler can be stood in for.
 */
export type WebpackCompileCompiler = {
    /**
     * The compiler hooks.
     */
    hooks: {
        /**
         * Runs before each compilation.
         */
        beforeCompile: {
            /**
             * Taps an async handler.
             */
            tapPromise: (name: string, run: () => Promise<void>) => void
        }
    }
};

/**
 * Writes what a build compiles and nobody writes by hand, before every compilation: the types of the
 * handlebars templates, the entities of the providers file, and the translation source of the framework
 * and of the application.
 */
export class GenerateSourcesOnBuildPlugin {
    constructor(private readonly root: string) {}

    /**
     * Applies the plugin to a webpack compiler.
     * @param compiler - The webpack compiler.
     */
    apply(compiler: WebpackCompileCompiler): void {
        compiler.hooks.beforeCompile.tapPromise('GenerateSourcesOnBuildPlugin', async () => {
            // of the project, wherever webpack was started, such as in the root of a monorepo
            await generateHandlebarTypeFiles(`${FsUtilities.getPath(this.root, 'src', 'templates')}/**/*.hbs`);
            await generateEntityFiles(this.root);
            await generateSourceXlf(FsUtilities.getPath(this.root), [
                // the framework's strings were extracted by its own build and ship with it, so a
                // build of the application scans only the application
                { sourceXlf: FsUtilities.getPath(resolveZibriRoot(), 'translations', 'source.xlf') },
                {
                    origin: 'project',
                    originLocale: 'en-US',
                    patterns: {
                        include: `${FsUtilities.getPath(this.root, 'src')}/**/*.{ts,tsx}`,
                        exclude: '**/*.test.{ts,tsx}'
                    }
                }
            ]);
        });
    }
}