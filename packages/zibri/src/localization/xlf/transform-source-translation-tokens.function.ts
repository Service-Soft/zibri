import type ts from '@typescript/typescript6';

import { FsPath, FsUtilities, GlobPattern } from '../../utilities/fs.utilities.ts';
import { optionalPeer } from '../../utilities/optional-peer.function.ts';
import { LocaleCode } from '../models/locale-code.model.ts';

/**
 * TypeScript's own module, as loaded at runtime.
 *
 * Only the types are imported at the top of this file. Extraction is a build step - it runs from the
 * application's build config - and a value import here would be resolved by every consumer the barrel reaches,
 * which a production image that pruned its devDependencies cannot do, and followed by every bundler,
 * which ships the whole compiler inside the application.
 */
type TypeScriptModule = typeof ts;

/**
 * Definition of a translation string extracted by the build step.
 */
export type ExtractedTranslationString = {
    /**
     * 'Hello {user.firstName} {user.lastName}'.
     */
    source: string,
    /**
     * Which language this string is written in.
     */
    sourceLocale: string,
    /**
     * The file path of the string.
     */
    file: string,
    /**
     * The line number of the string.
     */
    line: number,
    /**
     * Where the translation string comes from, eg. 'zibri' or 'project'.
     */
    origin: string
};

/**
 * Options for transforming source translations.
 */
type TransformOptions = {
    /**
     * Determined by caller based on file origin.
     */
    sourceLocale: LocaleCode,
    /**
     * The name of the file.
     */
    filename: string,
    /**
     * Relative display path — XLF notes (falls back to filename).
     */
    displayFilename: string,
    /**
     * Where the translation string comes from.
     */
    origin: string,
    /**
     * Defaults to TSX.
     */
    scriptKind: ts.ScriptKind
};

/**
 * The result of transforming a single file.
 * Consists of the actual code file content.
 */
export type TransformResult = {
    /**
     * The file content.
     */
    code: string,
    /**
     * Any extracted translation strings found in the file.
     */
    extracted: ExtractedTranslationString[]
};

/**
 * Definition of a source translation origin, this could eg. Be zibri, the project itself or a third party library.
 */
export type SourceTranslationOrigin = {
    /**
     * The glob patterns that should be scanned for translation strings.
     */
    patterns: GlobPattern,
    /**
     * The name of the origin, eg. 'zibri' or 'project'.
     */
    origin: string,
    /**
     * The default locale used in the origin.
     * For zibri this is for example always 'en-US'.
     */
    originLocale: LocaleCode
};

/**
 * Transforms all translation tokens found inside of the provided origins.
 * @param origins - A source could eg. Be zibri, the project itself or a third party library.
 * @returns A record of the file names and their transform result.
 */
export async function transformSourceTranslationOriginTokens(
    origins: SourceTranslationOrigin[]
): Promise<Record<string, TransformResult>> {
    // asked for before anything is read, so a missing compiler is named up front rather than only
    // once some origin turns out to have a file in it
    const typescript: TypeScriptModule = optionalPeer<TypeScriptModule>('@typescript/typescript6', 'Extracting source translations');
    const res: Record<string, TransformResult> = {};

    await Promise.all(origins.map(async origin => {
        const files: FsPath[] = await FsUtilities.glob(origin.patterns);
        await Promise.all(files.map(async file => {
            const fileContent: string = await FsUtilities.readFile(file);
            // const displayFilename: FsPath = FsUtilities.getPath('node_modules/zibri/src', file);
            const transformResult: TransformResult = transformSourceTranslationTokensInternal(typescript, fileContent, {
                filename: file,
                displayFilename: FsUtilities.relative(process.cwd() as FsPath, file), // TODO: fix
                sourceLocale: origin.originLocale,
                scriptKind: file.endsWith('.tsx') ? typescript.ScriptKind.TSX : typescript.ScriptKind.TS,
                origin: origin.origin
            });

            res[file] = transformResult;
        }));
    }));

    return res;
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
function transformSourceTranslationTokensInternal(
    typescript: TypeScriptModule,
    sourceCode: string,
    options: TransformOptions
): TransformResult {
    const extracted: ExtractedTranslationString[] = [];

    const sourceFile: ts.SourceFile = typescript.createSourceFile(
        options.filename,
        sourceCode,
        typescript.ScriptTarget.Latest,
        true,
        options.scriptKind
    );

    const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => (root) => {
        const visit: (node: ts.Node) => ts.Node = (node: ts.Node): ts.Node => {
            if (typescript.isTaggedTemplateExpression(node) && isTargetTag(typescript, node.tag)) {
                const { transformed, source } = rewriteTemplate(typescript, node, context.factory, sourceCode);
                const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
                extracted.push({
                    source,
                    sourceLocale: options.sourceLocale,
                    file: options.displayFilename ?? options.filename,
                    line: line + 1,
                    origin: options.origin ?? 'project'

                });
                return transformed;
            }
            return typescript.visitEachChild(node, visit, context);
        };
        return typescript.visitNode(root, visit) as ts.SourceFile;
    };

    // one file in, one file out
    const { transformed: [out = sourceFile] } = typescript.transform(sourceFile, [transformer]);
    const code: string = typescript.createPrinter({ newLine: typescript.NewLineKind.LineFeed }).printFile(out);
    return { code, extracted };
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
function isTargetTag(typescript: TypeScriptModule, node: ts.Expression): boolean {
    return typescript.isIdentifier(node) && (node.text === '$t' || node.text === '$ts');
}

/**
 * Gets the member key for the given node.
 * @param typescript - TypeScript's module.
 * @param node - The node to build the key for.
 * @returns The member access chain string if possible, or undefined for anything too complex.
 */
function getMemberKey(typescript: TypeScriptModule, node: ts.Expression): string | undefined {
    if (typescript.isIdentifier(node)) {
        return node.text;
    }
    if (typescript.isPropertyAccessExpression(node)) {
        const left: string | undefined = getMemberKey(typescript, node.expression);
        return left != undefined ? `${left}.${node.name.text}` : undefined;
    }
    return undefined;
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
function rewriteTemplate(
    typescript: TypeScriptModule,
    node: ts.TaggedTemplateExpression,
    factory: ts.NodeFactory,
    sourceCode: string
// eslint-disable-next-line jsdoc-js/require-jsdoc
): { transformed: ts.TaggedTemplateExpression, source: string } {
    const template: ts.TemplateLiteral = node.template;

    if (typescript.isNoSubstitutionTemplateLiteral(template)) {
        return { transformed: node, source: escapeBraces(template.text) };
    }

    let source: string = escapeBraces(template.head.text);

    const newSpans: ts.TemplateSpan[] = template.templateSpans.map((span, index) => {
        const expr: ts.Expression = span.expression;
        let key: string;
        let newExpr: ts.Expression;

        if (typescript.isObjectLiteralExpression(expr)) {
            // Already manually wrapped: ${{ "my.key": value }} — leave it alone
            const prop: ts.ObjectLiteralElementLike | undefined = expr.properties[0];
            key = prop != undefined
                && typescript.isPropertyAssignment(prop)
                && (typescript.isIdentifier(prop.name) || typescript.isStringLiteral(prop.name))
                ? prop.name.text
                : '_';
            newExpr = expr;
        }
        else {
            key = getMemberKey(typescript, expr)
                ?? getExpressionSourceText(sourceCode, expr)
                ?? `$${index + 1}`;
            newExpr = factory.createObjectLiteralExpression([factory.createPropertyAssignment(factory.createStringLiteral(key), expr)]);
        }

        source += `{${key}}${escapeBraces(span.literal.text)}`;
        return factory.updateTemplateSpan(span, newExpr, span.literal);
    });

    return {
        transformed: factory.updateTaggedTemplateExpression(
            node, node.tag, node.typeArguments, factory.updateTemplateExpression(template, template.head, newSpans)
        ),
        source
    };
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
function escapeBraces(text: string): string {
    return text.replaceAll('{', '{{').replaceAll('}', '}}');
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
function getExpressionSourceText(sourceCode: string, expr: ts.Expression): string | undefined {
    const text: string = sourceCode.slice(expr.getStart(), expr.getEnd()).trim();
    // If the text contains } it would break our {key} placeholder format — fall back to positional
    return text.includes('}') ? undefined : text;
}