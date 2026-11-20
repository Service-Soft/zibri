// What a forked process loads TypeScript with, preloaded in place of `ts-node/register`: ts-node,
// with a transpiler that keeps what each file transpiles to on disk. Each process forked to run
// TypeScript compiled every file of the framework again, which was two thirds of the five seconds it
// took to start; a process after the first reads what the one before it wrote.
//
// Still TypeScript's own `transpileModule`, so decorator metadata comes out exactly as the build has
// it. ts-node's own transpile-only path is a copy of it that can tell a file's module kind from its
// package.json, which nothing here needs: the forked processes are compiled to commonjs throughout.
//
// Loaded with a plain require, before ts-node can compile anything, so it is never run from a `.ts`
// file: `dist` holds it as JavaScript, and from the sources the parent transpiles it first (see
// resolveTypeScriptForkOptions).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { CreateTranspilerOptions, Transpiler, TranspileOptions, TranspileOutput } from 'ts-node';
import type * as TypeScript from 'typescript';

/**
 * The environment variable naming the folder the transpiled files are kept in.
 */
const CACHE_FOLDER_ENV: string = 'ZIBRI_TESTING_TYPESCRIPT_CACHE';

/**
 * Where what the given input transpiles to is kept: named by a hash of everything that decides it.
 * @param folder - The cache folder.
 * @param ts - The compiler.
 * @param input - The source.
 * @param options - How it is transpiled.
 * @returns The file.
 */
function resolveCacheFile(folder: string, ts: typeof TypeScript, input: string, options: TypeScript.TranspileOptions): string {
    const key: string = createHash('sha256')
        .update(ts.version)
        .update('\0')
        .update(options.fileName ?? '')
        .update('\0')
        .update(JSON.stringify(options.compilerOptions ?? {}))
        .update('\0')
        .update(input)
        .digest('hex');
    return path.join(folder, `${key}.json`);
}

/**
 * Builds the transpiler ts-node compiles each file with. Called by ts-node.
 * @param createOptions - What ts-node hands a transpiler.
 * @returns The transpiler.
 */
export function create(createOptions: CreateTranspilerOptions): Transpiler {
    const { config } = createOptions.service;
    // the copy of the compiler ts-node itself uses: the project's, found from where the process runs
    // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/no-require-imports
    const ts: typeof TypeScript = require(require.resolve('typescript', { paths: [process.cwd()] }));
    const cacheFolder: string | undefined = process.env[CACHE_FOLDER_ENV];
    if (cacheFolder != undefined) {
        mkdirSync(cacheFolder, { recursive: true });
    }
    return {
        transpile: (input: string, { fileName }: TranspileOptions): TranspileOutput => {
            const options: TypeScript.TranspileOptions = { fileName, compilerOptions: config.options, reportDiagnostics: true };
            if (cacheFolder == undefined) {
                return ts.transpileModule(input, options);
            }
            const file: string = resolveCacheFile(cacheFolder, ts, input, options);
            try {
                // eslint-disable-next-line typescript/no-unsafe-assignment
                const cached: TranspileOutput = JSON.parse(readFileSync(file, 'utf8'));
                return cached;
            }
            catch {
                // not transpiled yet
            }
            const output: TypeScript.TranspileOutput = ts.transpileModule(input, options);
            // a diagnostic holds the parsed file, which is no json; and ts-node reports it, so it is rare
            if (output.diagnostics?.length) {
                return output;
            }
            // under a name of its own first, so that a process reading it never finds half of it
            const partial: string = `${file}.${process.pid}.partial`;
            writeFileSync(partial, JSON.stringify(output));
            renameSync(partial, file);
            return output;
        }
    };
}

// registered once, after `create` is in place: ts-node requires this module again to find it, and is
// handed the copy that is loading. Options not given here come from the environment, as they do for
// ts-node/register
const REGISTER_INSTANCE: symbol = Symbol.for('ts-node.register.instance');
if (!(REGISTER_INSTANCE in process)) {
    // eslint-disable-next-line typescript/no-require-imports, typescript/no-unsafe-assignment
    const tsNode: typeof import('ts-node') = require('ts-node');
    tsNode.register({ transpiler: [__filename, {}] });
}