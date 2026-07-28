import { compile, CompiledPage, CompileResult } from 'zibri-tsx';

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
 * Compiles template source with the real zibri-tsx compiler and evaluates the emitted module, so
 * tests get exactly the compiled component that the webpack loader produces at build time.
 *
 * Templates may use the framework hooks without importing them; any other import is not supported,
 * which is all a rendering test needs.
 *
 * The result is a compiled-component object, but a template author declares it as a `TsxComponent`
 * function type — the build step swaps one for the other. Callers pass their declared template type
 * as `T` so the (inherent, boundary) cast lives here once instead of at every call site.
 * @param source - The template source.
 * @returns The compiled component, typed as the caller's template type.
 * @throws When the template does not compile.
 */
export function compileTsxTemplate<T = CompiledPage>(source: string): T {
    const result: CompileResult = compile(source);
    if (!result.code || !result.componentName) {
        throw new InternalError(
            // eslint-disable-next-line sonar/no-nested-template-literals
            `Template did not compile:\n${result.diagnostics.map(d => `${d.code}: ${d.message}`).join('\n')}`
        );
    }
    // The emitted module is esm; dropping the export keyword makes it evaluable as a function body.
    const body: string = `${result.code.replaceAll('export const ', 'const ')}\nreturn ${result.componentName};`;
    const hookNames: (keyof typeof templateHooks)[] = Object.keys(templateHooks) as (keyof typeof templateHooks)[];
    // eslint-disable-next-line typescript/no-implied-eval
    const load: (...hooks: unknown[]) => CompiledPage = new Function(...hookNames, body) as (
        ...hooks: unknown[]
    ) => CompiledPage;

    return load(...hookNames.map(name => templateHooks[name])) as T;
}