import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { Diagnostic, DiagnosticSeverity } from 'zibri-tsx';

import { MarkdownCompilerUtilities, MarkdownTemplate } from '../markdown/markdown-compiler';
import { MarkdownKind } from '../markdown/markdown-printer.model';
import { validateEmailComposition } from '../semantics/validate-email';

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
     * The warnings of the build, which it reports and passes with.
     */
    warnings: Error[],
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
     * One error per type error in a template, and per email component one places where MJML does not allow it.
     */
    errors: Error[],
    /**
     * One warning per email component a template places where MJML does not allow it, as long as such a template
     * builds.
     */
    warnings: Error[],
    /**
     * The templates it checked.
     */
    templates: string[]
};

/**
 * A webpack plugin that fails the build on a type error in a template, and warns about an email component a template
 * places where MJML does not allow it through a component of another file.
 *
 * The templates are compiled by the zibri-tsx loader rather than by the loader of the rest of the code, which
 * reports the type errors of the files it compiles. This checks the templates in the program of the
 * application's tsconfig and reports theirs, each with its file, line and column. A `.md` or `.mdx` template is
 * checked as the tsx template it is printed as, and its errors name the line of the markdown. What it learns is kept in
 * `node_modules/.cache/zibri-tsx` beside the tsconfig, so a later build checks only what changed.
 *
 * The loader checks the nesting of email components in each template alone. In the program, a component a template
 * imports is followed to the file declaring it: what it renders is judged against the parent its use sits in, and
 * what the use passes it, its children or another prop, against where it places them. Such a mistake is a warning,
 * which fails the build from 4.0.
 */
export class ZibriTsxTypeCheckPlugin {
    constructor(private readonly options: TypeCheckPluginOptions) {}

    /**
     * Applies the plugin to a webpack compiler.
     * @param compiler - The webpack compiler.
     */
    apply(compiler: TypeCheckCompilerLike): void {
        compiler.hooks.afterCompile.tap('ZibriTsxTypeCheckPlugin', compilation => {
            const { errors, warnings, templates } = this.resolveTemplateTypeCheck();
            // a template no bundled file imports is still checked, and still followed
            for (const template of templates) {
                compilation.fileDependencies.add(template);
            }
            compilation.errors.push(...errors);
            compilation.warnings.push(...warnings);
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
        const options: ts.CompilerOptions = {
            ...config.options,
            noEmit: true,
            incremental: true,
            composite: false,
            tsBuildInfoFile: buildInfo
        };
        // a markdown template is checked as the tsx template it is printed as, a file beside it only this program has
        const markdown: Map<string, MarkdownTemplateFile> = this.resolveMarkdownTemplates(templateDirs);
        const program: ts.EmitAndSemanticDiagnosticsBuilderProgram = ts.createIncrementalProgram({
            rootNames: [
                ...config.fileNames,
                ...[...markdown.values()].filter(file => file.template.tsx !== undefined).map(file => file.printedPath)
            ],
            options,
            host: this.createHost(options, markdown),
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
        const checker: ts.TypeChecker = program.getProgram().getTypeChecker();
        // the loader checks the nesting of each template alone, and this what it reaches through the components of
        // other files, which only the program knows
        const nesting: Diagnostic[][] = templates.map(file => validateEmailComposition(file, checker));
        const nestingReports: (severity: DiagnosticSeverity) => Error[] = severity => templates.flatMap((file, index) => nesting[index]
            .filter(diagnostic => diagnostic.severity === severity)
            .map(diagnostic => new Error(
                'zibri-tsx found an email component placed where MJML does not allow it:\n'
                + `${resolveLocation(file, diagnostic.span.start, markdown)} ${diagnostic.code} ${diagnostic.message}`
            )));
        const errors: Error[] = [
            ...templates
                .flatMap(file => program.getSemanticDiagnostics(file))
                .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
                .map(diagnostic => toError(diagnostic, markdown)),
            ...nestingReports(DiagnosticSeverity.ERROR)
        ];
        // with noEmit, emitting writes what was learned and nothing else
        mkdirSync(path.dirname(buildInfo), { recursive: true });
        program.emit();
        const printed: Set<string> = new Set([...markdown.values()].map(file => file.printedPath));
        return {
            errors,
            warnings: nestingReports(DiagnosticSeverity.WARNING),
            templates: [
                ...templates.map(file => path.resolve(file.fileName)).filter(file => !printed.has(file)),
                ...markdown.keys()
            ]
        };
    }

    /**
     * Prints the markdown templates of the template directories.
     * @param templateDirs - The directories.
     * @returns Each printed template, by the path of the file it is printed as.
     */
    private resolveMarkdownTemplates(templateDirs: string[]): Map<string, MarkdownTemplateFile> {
        const files: Map<string, MarkdownTemplateFile> = new Map();
        for (const file of findMarkdownFiles(templateDirs.map(dir => path.resolve(dir)))) {
            const kind: MarkdownKind | undefined = MarkdownCompilerUtilities.findMarkdownKind(file);
            if (kind === undefined) {
                continue;
            }
            const printedPath: string = `${file}.tsx`;
            files.set(
                printedPath,
                {
                    path: file,
                    printedPath,
                    template: MarkdownCompilerUtilities.resolveMarkdownTemplate(readFileSync(file, 'utf8'), kind, file)
                }
            );
        }
        return files;
    }

    /**
     * A compiler host that reads the printed markdown templates from memory, and every other file from the disk.
     * @param options - The options of the program.
     * @param markdown - The printed markdown templates.
     * @returns The host.
     */
    private createHost(options: ts.CompilerOptions, markdown: Map<string, MarkdownTemplateFile>): ts.CompilerHost {
        const host: ts.CompilerHost = ts.createIncrementalCompilerHost(options);
        const printedText: (fileName: string) => string | undefined = fileName => markdown.get(path.resolve(fileName))?.template.tsx;
        const { fileExists, readFile } = host;
        // replaced on the host itself, as its getSourceFile reads through it, and gives each file the version a
        // later build compares
        host.fileExists = fileName => printedText(fileName) !== undefined || fileExists(fileName);
        host.readFile = fileName => printedText(fileName) ?? readFile(fileName);
        return host;
    }
}

/**
 * A markdown template, printed as the tsx template the type check checks.
 */
type MarkdownTemplateFile = {
    /**
     * The markdown file.
     */
    path: string,
    /**
     * The file it is printed as, beside it, which exists only for the type check.
     */
    printedPath: string,
    /**
     * The printed template.
     */
    template: MarkdownTemplate
};

/**
 * Finds the markdown templates under the given directories.
 * @param dirs - The directories, missing ones ignored.
 * @returns The paths of the `.md` and `.mdx` files.
 */
function findMarkdownFiles(dirs: string[]): string[] {
    return dirs.flatMap(dir => {
        try {
            return readdirSync(dir, { recursive: true, encoding: 'utf8' })
                .filter(file => file.endsWith('.md') || file.endsWith('.mdx'))
                .map(file => path.join(dir, file));
        }
        catch {
            return [];
        }
    });
}

/**
 * A type error of a template, as the build reports it. One of a markdown template names the line of the markdown.
 * @param diagnostic - The type error.
 * @param markdown - The printed markdown templates, by the path of the file each is printed as.
 * @returns The error.
 */
function toError(diagnostic: ts.Diagnostic, markdown: Map<string, MarkdownTemplateFile>): Error {
    const message: string = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    return new Error(
        diagnostic.file === undefined || diagnostic.start === undefined
            ? `zibri-tsx found a type error in a template:\nTS${diagnostic.code} ${message}`
            // eslint-disable-next-line stylistic/max-len
            : `zibri-tsx found a type error in a template:\n${resolveLocation(diagnostic.file, diagnostic.start, markdown)} TS${diagnostic.code} ${message}`
    );
}

/**
 * Where a position of a template is, as the build reports it. One of a markdown template names the line of the markdown.
 * @param template - The template.
 * @param start - The position.
 * @param markdown - The printed markdown templates, by the path of the file each is printed as.
 * @returns The file, the line and the column.
 */
function resolveLocation(template: ts.SourceFile, start: number, markdown: Map<string, MarkdownTemplateFile>): string {
    const { line, character } = template.getLineAndCharacterOfPosition(start);
    const file: string = path.resolve(template.fileName);
    const printed: MarkdownTemplateFile | undefined = markdown.get(file);
    if (printed !== undefined) {
        // a line of the printed template leads to a line of the markdown, not to a column of it
        const markdownLine: number = printed.template.markdownLines[line] ?? 0;
        return `${printed.path}:${markdownLine + 1}:1`;
    }
    return `${file}:${line + 1}:${character + 1}`;
}