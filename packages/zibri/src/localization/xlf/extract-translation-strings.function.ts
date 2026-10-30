import type ts from 'typescript';

import { ExtractedTranslationString } from './models/extracted-translation-string.model';
import { ScannedTranslationOrigin } from './models/source-translation-origin.model';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { optionalPeer } from '../../utilities/optional-peer.function';
import { LocaleCode } from '../models/locale-code.model';

/**
 * TypeScript's own module, as loaded at runtime.
 *
 * Only the types are imported at the top of this file. Extraction is a build step - it runs from a
 * webpack config - and a value import here would be resolved by every consumer the barrel reaches,
 * which a production image that pruned its devDependencies cannot do, and followed by every bundler,
 * which ships the whole compiler inside the application.
 */
type TypeScriptModule = typeof ts;

/**
 * What the strings of one file are recorded with.
 */
type FileOptions = {
    /**
     * The file, relative to the root the strings are extracted for.
     */
    file: string,
    /**
     * The locale the file is written in.
     */
    sourceLocale: LocaleCode,
    /**
     * The origin the file belongs to.
     */
    origin: string,
    /**
     * Whether the file is tsx or ts.
     */
    scriptKind: ts.ScriptKind
};

/**
 * Finds every string the given origins mark for translation with `$t` or `$ts`.
 *
 * Each string is recorded as `$t` builds it at runtime: a placeholder is numbered by its position,
 * `{$1}`, unless the expression is an inline object with one key, which names it. The code is only
 * read, never changed.
 * @param root - The root the files are named relative to.
 * @param origins - The files to scan, by origin.
 * @returns The strings found, with where each one is.
 */
export async function extractTranslationStrings(
    root: FsPath,
    origins: ScannedTranslationOrigin[]
): Promise<ExtractedTranslationString[]> {
    // asked for before anything is read, so a missing compiler is named up front rather than only
    // once some origin turns out to have a file in it
    const typescript: TypeScriptModule = optionalPeer<TypeScriptModule>('typescript', 'Extracting source translations');

    const perOrigin: ExtractedTranslationString[][] = await Promise.all(origins.map(async origin => {
        const files: FsPath[] = await FsUtilities.glob(origin.patterns);
        const perFile: ExtractedTranslationString[][] = await Promise.all(files.map(async file => {
            const sourceCode: string = await FsUtilities.readFile(file);
            return extractFromFile(typescript, sourceCode, {
                file: FsUtilities.relative(root, file),
                sourceLocale: origin.originLocale,
                origin: origin.origin,
                scriptKind: file.endsWith('.tsx') ? typescript.ScriptKind.TSX : typescript.ScriptKind.TS
            });
        }));
        return perFile.flat();
    }));
    return perOrigin.flat();
}

// eslint-disable-next-line jsdoc/require-jsdoc
function extractFromFile(typescript: TypeScriptModule, sourceCode: string, options: FileOptions): ExtractedTranslationString[] {
    const extracted: ExtractedTranslationString[] = [];
    const sourceFile: ts.SourceFile = typescript.createSourceFile(
        options.file,
        sourceCode,
        typescript.ScriptTarget.Latest,
        true,
        options.scriptKind
    );

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (typescript.isTaggedTemplateExpression(node) && isTranslationTag(typescript, node.tag)) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            extracted.push({
                source: resolveSource(typescript, node.template),
                sourceLocale: options.sourceLocale,
                file: options.file,
                line: line + 1,
                origin: options.origin
            });
        }
        typescript.forEachChild(node, visit);
    };
    visit(sourceFile);

    return extracted;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function isTranslationTag(typescript: TypeScriptModule, tag: ts.Expression): boolean {
    return typescript.isIdentifier(tag) && (tag.text === '$t' || tag.text === '$ts');
}

/**
 * Builds the source string of a template the way `$t` does at runtime.
 * @param typescript - TypeScript's module.
 * @param template - The template literal of the tagged template.
 * @returns The source string, with a placeholder per interpolation.
 */
function resolveSource(typescript: TypeScriptModule, template: ts.TemplateLiteral): string {
    if (typescript.isNoSubstitutionTemplateLiteral(template)) {
        return escapeBraces(template.text);
    }
    let source: string = escapeBraces(template.head.text);
    for (const [index, span] of template.templateSpans.entries()) {
        source += `{${resolvePlaceholderName(typescript, span.expression, index)}}${escapeBraces(span.literal.text)}`;
    }
    return source;
}

/**
 * Resolves the name `$t` gives the placeholder of an interpolated expression.
 *
 * `$t` names it after the single key of an object it is handed, and numbers it otherwise. Only an
 * inline object literal shows that key here; any other expression is recorded as numbered, which
 * is what `$t` does with every value that is not a single key object.
 * @param typescript - TypeScript's module.
 * @param expression - The interpolated expression.
 * @param index - The index of the interpolation.
 * @returns The placeholder name.
 */
function resolvePlaceholderName(typescript: TypeScriptModule, expression: ts.Expression, index: number): string {
    const unwrapped: ts.Expression = unwrapTypeSyntax(typescript, expression);
    if (typescript.isObjectLiteralExpression(unwrapped) && unwrapped.properties.length === 1) {
        const property: ts.ObjectLiteralElementLike | undefined = unwrapped.properties[0];
        const name: ts.PropertyName | undefined = property != undefined
            && (typescript.isPropertyAssignment(property) || typescript.isShorthandPropertyAssignment(property))
            ? property.name
            : undefined;
        if (name != undefined && (typescript.isIdentifier(name) || typescript.isStringLiteral(name))) {
            return name.text;
        }
    }
    return `$${index + 1}`;
}

/**
 * Strips what changes a type but not the value: parentheses, `as`, `satisfies` and `!`.
 * @param typescript - TypeScript's module.
 * @param expression - The expression to unwrap.
 * @returns The expression that is evaluated.
 */
function unwrapTypeSyntax(typescript: TypeScriptModule, expression: ts.Expression): ts.Expression {
    let current: ts.Expression = expression;
    while (
        typescript.isParenthesizedExpression(current)
        || typescript.isAsExpression(current)
        || typescript.isSatisfiesExpression(current)
        || typescript.isNonNullExpression(current)
        || typescript.isTypeAssertionExpression(current)
    ) {
        current = current.expression;
    }
    return current;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function escapeBraces(text: string): string {
    return text.replaceAll('{', '{{').replaceAll('}', '}}');
}