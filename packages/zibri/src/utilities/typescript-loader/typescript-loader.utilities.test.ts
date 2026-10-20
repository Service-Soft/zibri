import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TypeScriptLoaderUtilities } from './typescript-loader.utilities.ts';
import { testFileFolder } from '../../__testing__/constants.ts';
import { JsonUtilities } from '../json.utilities.ts';

/**
 * The loader as the sources have it, loaded by the child processes below through node's own type
 * stripping - the way a test cluster instance has to load it before anything else can be compiled.
 */
const loaderSource: string = path.join(import.meta.dirname, 'typescript-loader.utilities.ts');

const fixtureRoot: string = path.join(testFileFolder, 'typescript-loader');

/**
 * A decorated class with everything the framework reads off one: a class decorator, a parameter
 * decorator, the constructor's parameter types and a property's type. Written once as an es module
 * and once as commonjs, which differ only in how they import and export.
 * @param style - How the file imports and exports.
 * @returns The file's content.
 */
function decoratedSource(style: 'module' | 'commonjs'): string {
    const imports: string = style === 'module'
        ? 'import \'reflect-metadata\';\nimport { Dependency } from \'./dependency.ts\';'
        : 'require(\'reflect-metadata\');\nconst { Dependency } = require(\'./dependency.cts\');';
    const exported: string = style === 'module' ? 'export const summary' : 'module.exports.summary';
    return `${imports}

const injected: string[] = [];

function Injectable(): ClassDecorator {
    return () => undefined;
}

function Inject(token: string): ParameterDecorator {
    return () => {
        injected.push(token);
    };
}

function Prop(): PropertyDecorator {
    return () => undefined;
}

enum Kind {
    A = 'a'
}

@Injectable()
class Service {
    @Prop()
    name!: string;

    constructor(@Inject('token') readonly dependency: Dependency) {}
}

${exported} = {
    paramTypes: (Reflect.getMetadata('design:paramtypes', Service) as Function[]).map(type => type.name),
    nameType: (Reflect.getMetadata('design:type', Service.prototype, 'name') as Function).name,
    injected,
    kind: Kind.A,
    parameterProperty: new Service(new Dependency()).dependency instanceof Dependency
};
`;
}

/**
 * What {@link decoratedSource} reports when it was compiled the way the framework needs.
 */
const DECORATED_SUMMARY: Record<string, unknown> = {
    paramTypes: ['Dependency'],
    nameType: 'String',
    injected: ['token'],
    kind: 'a',
    parameterProperty: true
};

/**
 * Writes a folder of fixtures.
 * @param folder - The folder, below the fixture root.
 * @param files - The files, by name.
 */
function writeFixtures(folder: string, files: Record<string, string>): void {
    mkdirSync(path.join(fixtureRoot, folder), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(fixtureRoot, folder, name)), { recursive: true });
        writeFileSync(path.join(fixtureRoot, folder, name), content);
    }
}

/**
 * Runs a script in a process of its own with the loader registered, the way a worker thread or a
 * cluster instance has it: nothing but node, no test runner transforming anything.
 * @param body - The script, which must print one line of json.
 * @returns Whatever it printed, parsed.
 */
function withLoader<T>(body: string): T {
    const script: string = `
        import { createRequire } from 'node:module';
        import { pathToFileURL } from 'node:url';
        const { TypeScriptLoaderUtilities } = await import(${JsonUtilities.stringify(pathToFileURL(loaderSource).href)});
        TypeScriptLoaderUtilities.register('The fixture');
        const root = ${JsonUtilities.stringify(fixtureRoot)};
        const require = createRequire(root + '/index.cjs');
        const importing = file => import(pathToFileURL(root + '/' + file).href);
        ${body}
    `;
    const output: string = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000
    });
    return JsonUtilities.parse(output);
}

describe('TypeScriptLoaderUtilities', () => {
    beforeAll(() => {
        writeFixtures('typed-module', {
            'package.json': '{ "type": "module" }',
            'dependency.ts': 'export class Dependency {}',
            'service.ts': decoratedSource('module'),
            'other.mts': 'export const extension: string = \'mts\';',
            'thrower.ts': '\n\nexport function fail(): never {\n    throw new Error(\'from line 4\');\n}\n',
            'broken.ts': 'export const = ;',
            'node_modules/compiled-elsewhere/index.ts': 'export const value: number = 1;'
        });
        writeFixtures('typed-commonjs', {
            'package.json': '{ "type": "commonjs" }',
            'dependency.cts': 'module.exports.Dependency = class Dependency {};',
            'service.ts': decoratedSource('commonjs')
        });
        writeFixtures('untyped', {
            'package.json': '{}',
            'dependency.ts': 'export class Dependency {}',
            'service.ts': decoratedSource('module'),
            'plain.ts': 'module.exports.format = typeof __dirname === \'string\' ? \'commonjs\' : \'module\';'
        });
    });

    afterAll(() => {
        rmSync(fixtureRoot, { recursive: true, force: true });
    });

    it('compiles an es module with the decorators and the metadata the framework reads', () => {
        const res: { imported: unknown, required: unknown } = withLoader(`
            const imported = (await importing('typed-module/service.ts')).summary;
            const required = require(root + '/typed-module/service.ts').summary;
            console.log(JSON.stringify({ imported, required }));
        `);

        // required as well as imported: a worker file is handed to `require` first, and the helpers
        // the compiled code imports have to answer both
        expect(res.imported).toStrictEqual(DECORATED_SUMMARY);
        expect(res.required).toStrictEqual(DECORATED_SUMMARY);
    });

    it('compiles a commonjs file in a package that says it is commonjs', () => {
        const res: { required: unknown, imported: unknown } = withLoader(`
            const required = require(root + '/typed-commonjs/service.ts').summary;
            const imported = (await importing('typed-commonjs/service.ts')).summary;
            console.log(JSON.stringify({ required, imported }));
        `);

        expect(res.required).toStrictEqual(DECORATED_SUMMARY);
        expect(res.imported).toStrictEqual(DECORATED_SUMMARY);
    });

    it('takes the format from the syntax in a package that does not say', () => {
        const res: { summary: unknown, plain: string } = withLoader(`
            const summary = (await importing('untyped/service.ts')).summary;
            const plain = require(root + '/untyped/plain.ts').format;
            console.log(JSON.stringify({ summary, plain }));
        `);

        // node's own detection would strip the types first, which fails on the parameter decorator
        expect(res.summary).toStrictEqual(DECORATED_SUMMARY);
        expect(res.plain).toBe('commonjs');
    });

    it('compiles a .mts file', () => {
        const res: { extension: string } = withLoader(`
            const { extension } = await importing('typed-module/other.mts');
            console.log(JSON.stringify({ extension }));
        `);

        expect(res.extension).toBe('mts');
    });

    it('points a stack trace into the TypeScript file', () => {
        const res: { frame: string } = withLoader(`
            const { fail } = await importing('typed-module/thrower.ts');
            let frame = 'it did not throw';
            try {
                fail();
            }
            catch (error) {
                frame = error.stack.split('\\n')[1];
            }
            console.log(JSON.stringify({ frame }));
        `);

        expect(res.frame).toContain(`${path.join(fixtureRoot, 'typed-module', 'thrower.ts')}:4:`);
    });

    it('names the file that does not compile', () => {
        const res: { message: string } = withLoader(`
            let message = 'it compiled';
            try {
                await importing('typed-module/broken.ts');
            }
            catch (error) {
                message = error.message;
            }
            console.log(JSON.stringify({ message }));
        `);

        expect(res.message).toContain(path.join(fixtureRoot, 'typed-module', 'broken.ts'));
        expect(res.message).toContain('could not be compiled');
    });

    it('leaves a file inside node_modules to node', () => {
        const res: { code: string } = withLoader(`
            let code = 'it was compiled';
            try {
                await importing('typed-module/node_modules/compiled-elsewhere/index.ts');
            }
            catch (error) {
                code = error.code;
            }
            console.log(JSON.stringify({ code }));
        `);

        // a dependency ships compiled, and node refuses to strip the types of one itself
        expect(res.code).toBe('ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING');
    });

    it('knows which files it is needed for', () => {
        expect(['a.ts', 'a.mts', 'a.cts', 'A.TS'].map(file => TypeScriptLoaderUtilities.isNeededFor(file))).toStrictEqual([true, true, true, true]);
        expect(['a.js', 'a.mjs', 'a.cjs', 'a.json'].map(file => TypeScriptLoaderUtilities.isNeededFor(file))).toStrictEqual([false, false, false, false]);
    });
});
