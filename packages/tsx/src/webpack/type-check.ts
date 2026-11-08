import { mkdirSync } from 'node:fs';
import path from 'node:path';

import * as ts from 'typescript';

/**
 * Options for {@link ZibriTsxTypeCheckPlugin}.
 */
export type TypeCheckPluginOptions = {
    /**
     * The application's tsconfig, whose program the templates are checked in.
     */
    tsconfig: string,
    /**
     * The directories of the templates, which the build hands the zibri-tsx loader.
     */
    templateDirs: string[]
};

/**
 * The subset of a webpack compilation this plugin uses.
 */
export type TypeCheckCompilation = {
    /**
     * The errors of the build, which fail it.
     */
    errors: Error[],
    /**
     * The files a rebuild of watch mode follows.
     */
    fileDependencies: {
        /**
         * Follows a file.
         */
        add: (file: string) => void
    }
};

/**
 * The subset of webpack's compiler this plugin uses.
 */
export type TypeCheckCompilerLike = {
    /**
     * The compiler hooks.
     */
    hooks: {
        /**
         * Runs once the modules of a build are compiled.
         */
        afterCompile: {
            /**
             * Taps a handler.
             */
            tap: (name: string, fn: (compilation: TypeCheckCompilation) => void) => void
        }
    }
};

/**
 * What the type check of the templates found.
 */
type TemplateTypeCheck = {
    /**
     * One error per type error in a template.
     */
    errors: Error[],
    /**
     * The templates it checked.
     */
    templates: string[]
};

/**
 * A webpack plugin that fails the build on a type error in a template.
 *
 * The templates are compiled by the zibri-tsx loader rather than by the loader of the rest of the code, which
 * reports the type errors of the files it compiles. This checks the templates in the program of the
 * application's tsconfig and reports theirs, each with its file, line and column. What it learns is kept in
 * `node_modules/.cache/zibri-tsx` beside the tsconfig, so a later build checks only what changed.
 */
export class ZibriTsxTypeCheckPlugin {
    constructor(private readonly options: TypeCheckPluginOptions) {}

    /**
     * Applies the plugin to a webpack compiler.
     * @param compiler - The webpack compiler.
     */
    apply(compiler: TypeCheckCompilerLike): void {
        compiler.hooks.afterCompile.tap('ZibriTsxTypeCheckPlugin', compilation => {
            const { errors, templates } = this.resolveTemplateTypeCheck();
            // a template no bundled file imports is still checked, and still followed
            for (const template of templates) {
                compilation.fileDependencies.add(template);
            }
            compilation.errors.push(...errors);
        });
    }

    private resolveTemplateTypeCheck(): TemplateTypeCheck {
        const { tsconfig, templateDirs } = this.options;
        const config: ts.ParsedCommandLine | undefined = ts.getParsedCommandLineOfConfigFile(tsconfig, {}, {
            ...ts.sys,
            onUnRecoverableConfigFileDiagnostic: diagnostic => {
                throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
            }
        });
        if (config === undefined) {
            throw new Error(`The tsconfig '${tsconfig}' cannot be read.`);
        }
        const buildInfo: string = path.join(path.dirname(tsconfig), 'node_modules', '.cache', 'zibri-tsx', 'templates.tsbuildinfo');
        const program: ts.EmitAndSemanticDiagnosticsBuilderProgram = ts.createIncrementalProgram({
            rootNames: config.fileNames,
            options: { ...config.options, noEmit: true, incremental: true, composite: false, tsBuildInfoFile: buildInfo },
            configFileParsingDiagnostics: config.errors
        });
        const dirs: string[] = templateDirs.map(dir => `${path.resolve(dir)}${path.sep}`);
        const isTemplate: (file: ts.SourceFile) => boolean = file => file.fileName.endsWith('.tsx')
            && dirs.some(dir => path.resolve(file.fileName).startsWith(dir));
        // the diagnostics of a file are answered from what the last build learned, which only stops counting once
        // every file a change affects is taken out: a template is otherwise checked against the component it
        // renders as it was. Every other file is the loader's to check, and skipped
        while (program.getSemanticDiagnosticsOfNextAffectedFile(undefined, file => !isTemplate(file)) !== undefined) {
            // each turn checks one affected template again
        }
        const templates: ts.SourceFile[] = program.getSourceFiles().filter(isTemplate);
        const errors: Error[] = templates
            .flatMap(file => program.getSemanticDiagnostics(file))
            .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
            .map(toError);
        // with noEmit, emitting writes what was learned and nothing else
        mkdirSync(path.dirname(buildInfo), { recursive: true });
        program.emit();
        return { errors, templates: templates.map(file => path.resolve(file.fileName)) };
    }
}

/**
 * A type error of a template, as the build reports it.
 * @param diagnostic - The type error.
 * @returns The error.
 */
function toError(diagnostic: ts.Diagnostic): Error {
    const message: string = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    if (diagnostic.file === undefined || diagnostic.start === undefined) {
        return new Error(`zibri-tsx found a type error in a template:\nTS${diagnostic.code} ${message}`);
    }
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    const file: string = path.resolve(diagnostic.file.fileName);
    return new Error(`zibri-tsx found a type error in a template:\n${file}:${line + 1}:${character + 1} TS${diagnostic.code} ${message}`);
}