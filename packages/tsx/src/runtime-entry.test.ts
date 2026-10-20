import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The built package, which is the only thing that can answer this question.
 *
 * Whether an import survives to the emitted file is the whole point, so the source tree says
 * nothing about it - and module resolution is process-wide, so the check runs in a child.
 */
const distPath: string = join(import.meta.dirname, '..', 'dist');

/**
 * Every entry point the package publishes, relative to `dist`.
 */
const ENTRIES: string[] = ['index.js', 'compiler.js', 'vite/index.js', 'email/index.js', 'jsx-runtime.js'];

/**
 * The packages that provide typescript.
 */
const TYPESCRIPT_PACKAGES: string[] = ['typescript', '@typescript/typescript6'];

/**
 * How the child process loads an entry point: as an es module application imports it, or as a
 * commonjs application requires it.
 */
type Loader = 'import' | 'require';

/**
 * What the child reported about loading an entry point.
 */
type LoadOutcome = {
    /**
     * Whether the entry point loaded.
     */
    loaded: boolean,
    /**
     * The failure, if it did not.
     */
    message: string,
    /**
     * The names the entry point exports.
     */
    keys: string[]
};

/**
 * Runs an es module script in a child process.
 * @param body - The script, which reports by writing to stdout.
 * @param hidden - The packages module resolution pretends are not installed, failing the way it fails for a
 * package that is missing.
 * @returns What the script wrote.
 */
function runInChild(body: string, hidden: string[]): string {
    const script: string = `
        import { createRequire, registerHooks } from 'node:module';
        import { pathToFileURL } from 'node:url';
        const hidden = ${JSON.stringify(hidden)};
        registerHooks({
            resolve(specifier, context, nextResolve) {
                if (hidden.includes(specifier)) {
                    const error = new Error("Cannot find package '" + specifier + "'");
                    error.code = 'ERR_MODULE_NOT_FOUND';
                    throw error;
                }
                return nextResolve(specifier, context);
            }
        });
        ${body}
    `;
    return execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30000 });
}

/**
 * Loads one built entry point in a child process.
 * @param entry - The entry file, relative to `dist`.
 * @param loader - How the entry point is loaded.
 * @param hidden - The packages module resolution pretends are not installed.
 * @returns What the child reported.
 */
function loadInChild(entry: string, loader: Loader, hidden: string[] = []): LoadOutcome {
    const output: string = runInChild(`
        const file = ${JSON.stringify(join(distPath, entry))};
        try {
            const loaded = ${loader === 'require' ? 'createRequire(file)(file)' : 'await import(pathToFileURL(file).href)'};
            process.stdout.write(JSON.stringify({ loaded: true, message: '', keys: Object.keys(loaded) }));
        }
        catch (error) {
            process.stdout.write(JSON.stringify({ loaded: false, message: error.message, keys: [] }));
        }
    `, hidden);
    return JSON.parse(output) as LoadOutcome;
}

describe('the runtime entry point', () => {
    it('is built', () => {
        // the rest of this file reads `dist`, so a stale or absent build would make it pass by
        // describing nothing.
        for (const entry of ENTRIES) {
            expect(existsSync(join(distPath, entry))).toBe(true);
        }
    });

    it('loads without typescript installed', () => {
        // an application imports this entry to render a page, and a compiler is a build-time tool.
        // Reaching one from here would put TypeScript in every deployed bundle - and the reason the
        // parser may use TypeScript at all is that nothing shipped to a running application does.
        expect(loadInChild('index.js', 'import', TYPESCRIPT_PACKAGES)).toMatchObject({ loaded: true });
    });

    it('loads the Vite plugin without typescript installed, and names the package once it compiles', () => {
        // typescript's parser is an optional peer dependency: an application's vite config imports the
        // plugin whether or not it is there, and the first template is where it is needed
        expect(loadInChild('vite/index.js', 'import', TYPESCRIPT_PACKAGES)).toMatchObject({ loaded: true });

        const output: string = runInChild(`
            const { zibriTsx } = await import(pathToFileURL(${JSON.stringify(join(distPath, 'vite', 'index.js'))}).href);
            const [plugin] = zibriTsx({ templateDirs: ['/app/templates'], vendorOutDir: '/app/vendor' });
            try {
                await plugin.transform.call({ error: error => { throw error; } }, 'export const A = () => <div/>;', '/app/templates/a.tsx');
                process.stdout.write('compiled');
            }
            catch (error) {
                process.stdout.write(error.message);
            }
        `, TYPESCRIPT_PACKAGES);
        expect(output).toContain('npm install --save-dev @typescript/typescript6');
    });

    it.each(ENTRIES)('loads %s into a commonjs application', entry => {
        // the package is published as es modules only, and a commonjs application requires them.
        // That works for any module without top-level await, which is what this keeps true
        expect(loadInChild(entry, 'require')).toMatchObject({ loaded: true });
    });

    it('does not expose the compiler', () => {
        const { keys } = loadInChild('index.js', 'import');

        expect(keys).not.toContain('parse');
        expect(keys).not.toContain('parseTemplate');
        expect(keys).not.toContain('compile');
        expect(keys).toContain('createServerRuntime');
        expect(keys).toContain('renderPage');
    });

    it('keeps the compiler reachable on its own subpath', () => {
        const { keys } = loadInChild('compiler.js', 'import');

        expect(keys).toContain('parseTemplate');
        expect(keys).toContain('compile');
    });
});
