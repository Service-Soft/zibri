import ts from 'typescript';

import { FsPath, FsUtilities, GlobPattern } from '../../utilities/fs.utilities';
import { LocaleCode } from '../models/locale-code.model';

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
    const res: Record<string, TransformResult> = {};

    await Promise.all(origins.map(async origin => {
        const files: FsPath[] = await FsUtilities.glob(origin.patterns);
        await Promise.all(files.map(async file => {
            const fileContent: string = await FsUtilities.readFile(file);
            // const displayFilename: FsPath = FsUtilities.getPath('node_modules/zibri/src', file);
            const transformResult: TransformResult = transformSourceTranslationTokensInternal(fileContent, {
                filename: file,
                displayFilename: FsUtilities.relative(process.cwd() as FsPath, file), // TODO: fix
                sourceLocale: origin.originLocale,
                scriptKind: file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
                origin: origin.origin
            });

            res[file] = transformResult;
        }));
    }));

    return res;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function transformSourceTranslationTokensInternal(sourceCode: string, options: TransformOptions): TransformResult {
    const extracted: ExtractedTranslationString[] = [];

    const sourceFile: ts.SourceFile = ts.createSourceFile(
        options.filename,
        sourceCode,
        ts.ScriptTarget.Latest,
        true,
        options.scriptKind
    );

    const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => (root) => {
        const visit: (node: ts.Node) => ts.Node = (node: ts.Node): ts.Node => {
            if (ts.isTaggedTemplateExpression(node) && isTargetTag(node.tag)) {
                const { transformed, source } = rewriteTemplate(node, context.factory, sourceCode);
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
            return ts.visitEachChild(node, visit, context);
        };
        return ts.visitNode(root, visit) as ts.SourceFile;
    };

    const { transformed: [out] } = ts.transform(sourceFile, [transformer]);
    const code: string = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(out);
    return { code, extracted };
}

// eslint-disable-next-line jsdoc/require-jsdoc
function isTargetTag(node: ts.Expression): boolean {
    return ts.isIdentifier(node) && (node.text === '$t' || node.text === '$ts');
}

/**
 * Gets the member key for the given node.
 * @param node - The node to build the key for.
 * @returns The member access chain string if possible, or undefined for anything too complex.
 */
function getMemberKey(node: ts.Expression): string | undefined {
    if (ts.isIdentifier(node)) {
        return node.text;
    }
    if (ts.isPropertyAccessExpression(node)) {
        const left: string | undefined = getMemberKey(node.expression);
        return left != undefined ? `${left}.${node.name.text}` : undefined;
    }
    return undefined;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function rewriteTemplate(
    node: ts.TaggedTemplateExpression,
    factory: ts.NodeFactory,
    sourceCode: string
// eslint-disable-next-line jsdoc/require-jsdoc
): { transformed: ts.TaggedTemplateExpression, source: string } {
    const template: ts.TemplateLiteral = node.template;

    if (ts.isNoSubstitutionTemplateLiteral(template)) {
        return { transformed: node, source: template.text };
    }

    let source: string = escapeBraces(template.head.text);

    const newSpans: ts.TemplateSpan[] = template.templateSpans.map((span, index) => {
        const expr: ts.Expression = span.expression;
        let key: string;
        let newExpr: ts.Expression;

        if (ts.isObjectLiteralExpression(expr)) {
            // Already manually wrapped: ${{ "my.key": value }} — leave it alone
            const prop: ts.ObjectLiteralElementLike = expr.properties[0];
            key = ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
                ? prop.name.text
                : '_';
            newExpr = expr;
        }
        else {
            key = getMemberKey(expr)
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

// eslint-disable-next-line jsdoc/require-jsdoc
function escapeBraces(text: string): string {
    return text.replaceAll('{', '{{').replaceAll('}', '}}');
}

// eslint-disable-next-line jsdoc/require-jsdoc
function getExpressionSourceText(sourceCode: string, expr: ts.Expression): string | undefined {
    const text: string = sourceCode.slice(expr.getStart(), expr.getEnd()).trim();
    // If the text contains } it would break our {key} placeholder format — fall back to positional
    return text.includes('}') ? undefined : text;
}