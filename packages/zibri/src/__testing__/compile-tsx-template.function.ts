import * as zibriTsx from 'zibri-tsx';
import { CompiledPage, MdxFrontmatter, MdxHeading } from 'zibri-tsx';
import { compile, CompileResult, MarkdownCompilerUtilities } from 'zibri-tsx-compiler';

import { InternalError } from '../error-handling/internal-error.model';
import { $f } from '../localization/format.function';
import { $t, $ts } from '../localization/translate.function';
import { onClient } from '../tsx/on-client.hook';
import { onServer } from '../tsx/on-server.hook';

/**
 * The framework hooks a template would normally import from zibri. The real implementations are
 * used, so `onClient` bodies stay out of the server render exactly like they do in production.
 */
// eslint-disable-next-line typescript/typedef
const templateHooks = { onClient, onServer, $t, $ts, $f } as const;

/**
 * What a `.md` template compiles to, as a page imports it with `import * as page from './page.md'`.
 */
type CompiledMarkdownModule<T> = {
    default: T,
    frontmatter: MdxFrontmatter,
    headings: MdxHeading[]
};

/**
 * Compiles template source with the real zibri-tsx compiler and evaluates the emitted module, so
 * tests get exactly the compiled component that the webpack loader produces at build time.
 *
 * Templates may use the framework hooks without importing them, and the globals they are given; any other
 * import is not supported, which is all a rendering test needs.
 *
 * The result is a compiled-component object, but a template author declares it as a `TsxComponent`
 * function type — the build step swaps one for the other. Callers pass their declared template type
 * as `T` so the (inherent, boundary) cast lives here once instead of at every call site.
 * @param source - The template source.
 * @param globals - What the template names without importing it, beside the hooks, such as a component of zibri.
 * @returns The compiled component, typed as the caller's template type.
 * @throws When the template does not compile.
 */
export function compileTsxTemplate<T = CompiledPage>(source: string, globals: Record<string, unknown> = {}): T {
    const result: CompileResult = compile(source);
    if (!result.code || !result.componentName) {
        throw new InternalError(
            // eslint-disable-next-line sonar/no-nested-template-literals
            `Template did not compile:\n${result.diagnostics.map(d => `${d.code}: ${d.message}`).join('\n')}`
        );
    }
    // The emitted module is esm; dropping the export keyword makes it evaluable as a function body.
    const body: string = `${result.code.replaceAll('export const ', 'const ')}\nreturn ${result.componentName};`;
    const named: Record<string, unknown> = { ...templateHooks, ...globals };
    // eslint-disable-next-line typescript/no-implied-eval
    const load: (...values: unknown[]) => CompiledPage = new Function(...Object.keys(named), body) as (
        ...values: unknown[]
    ) => CompiledPage;

    return load(...Object.values(named)) as T;
}

/**
 * Compiles a `.md` template as the webpack loader does, and evaluates the emitted module, its imports of zibri-tsx
 * resolved to the package.
 * @param source - The markdown.
 * @returns The page, its default export, typed as the caller's template type.
 * @throws When the markdown does not compile.
 */
export function compileMarkdownTemplate<T = CompiledPage>(source: string): T {
    return compileMarkdownModule<T>(source).default;
}

/**
 * Compiles a `.md` template as the webpack loader does into the module a page imports it as: the page, its frontmatter
 * and its headings.
 * @param source - The markdown.
 * @returns The module, its page typed as the caller's template type.
 * @throws When the markdown does not compile.
 */
export function compileMarkdownModule<T = CompiledPage>(source: string): CompiledMarkdownModule<T> {
    const result: CompileResult = MarkdownCompilerUtilities.compileMarkdown(source, 'md', { module: 'cjs' });
    if (result.code === undefined) {
        throw new InternalError(
            // eslint-disable-next-line sonar/no-nested-template-literals
            `Template did not compile:\n${result.diagnostics.map(d => `${d.code}: ${d.message}`).join('\n')}`
        );
    }
    const exported: Record<string, unknown> = {};
    // eslint-disable-next-line typescript/no-implied-eval
    const run: (exports: Record<string, unknown>, require: (id: string) => unknown) => void = new Function(
        'exports',
        'require',
        result.code
    ) as (exports: Record<string, unknown>, require: (id: string) => unknown) => void;
    run(exported, id => id === 'zibri-tsx' ? zibriTsx : {});
    return {
        default: exported['default'] as T,
        frontmatter: exported['frontmatter'] as MdxFrontmatter,
        headings: exported['headings'] as MdxHeading[]
    };
}