import * as ts from 'typescript';

import { Diagnostic, DiagnosticSeverity } from '../diagnostics/diagnostic.model';

/**
 * The name a template is parsed under. Nothing is resolved against it: a template is resolved on its own.
 */
const TEMPLATE_FILE_NAME: string = '/template.tsx';

/**
 * Resolves names within the template alone: no lib, no imported module, no type package. A name that
 * resolves to nothing is therefore declared nowhere in the template.
 */
const RESOLUTION_OPTIONS: ts.CompilerOptions = {
    noLib: true,
    noResolve: true,
    types: [],
    noEmit: true,
    jsx: ts.JsxEmit.Preserve
};

/**
 * The code a syntax error from TypeScript's parser carries.
 */
const SYNTAX_ERROR_CODE: string = 'ZTSX_PARSE';

/**
 * The program each parsed template belongs to.
 */
const programs: WeakMap<ts.SourceFile, ts.Program> = new WeakMap<ts.SourceFile, ts.Program>();

/**
 * Parses a template source into TypeScript's syntax tree, with its names resolved to the declarations
 * they refer to.
 * @param source - The template source.
 * @returns The parsed file, with parent links set.
 */
export function parseTemplate(source: string): ts.SourceFile {
    const file: ts.SourceFile = ts.createSourceFile(TEMPLATE_FILE_NAME, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
    programs.set(file, ts.createProgram({ rootNames: [TEMPLATE_FILE_NAME], options: RESOLUTION_OPTIONS, host: templateHost(file) }));
    return file;
}

/**
 * The syntax errors of a parsed template, as TypeScript's parser reports them.
 * @param file - A tree from {@link parseTemplate}.
 * @returns One diagnostic per syntax error (empty when the source is well-formed).
 */
export function syntaxErrorsOf(file: ts.SourceFile): Diagnostic[] {
    return programOf(file)
        .getSyntacticDiagnostics(file)
        .map(diagnostic => {
            const start: number = diagnostic.start ?? 0;
            return {
                code: SYNTAX_ERROR_CODE,
                message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
                severity: DiagnosticSeverity.ERROR,
                span: { start, end: start + (diagnostic.length ?? 0) }
            };
        });
}

/**
 * The program a parsed template belongs to.
 * @param file - A tree from {@link parseTemplate}.
 * @returns The program.
 * @throws When the tree was not parsed by {@link parseTemplate}.
 */
function programOf(file: ts.SourceFile): ts.Program {
    const program: ts.Program | undefined = programs.get(file);
    if (program === undefined) {
        throw new Error('Names can only be resolved in a tree parsed by parseTemplate.');
    }
    return program;
}

/**
 * A compiler host that knows exactly one file.
 * @param file - The template.
 * @returns The host.
 */
function templateHost(file: ts.SourceFile): ts.CompilerHost {
    return {
        getSourceFile: fileName => fileName === file.fileName ? file : undefined,
        getDefaultLibFileName: () => '/lib.d.ts',
        writeFile: () => undefined,
        getCurrentDirectory: () => '/',
        getCanonicalFileName: fileName => fileName,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
        fileExists: fileName => fileName === file.fileName,
        readFile: fileName => fileName === file.fileName ? file.text : undefined
    };
}

/**
 * The symbol an identifier refers to, or declares.
 *
 * Every identifier resolving to the same symbol means the same variable, whatever other bindings share
 * its name. In `{ a }` the identifier is the value read, not the property it creates.
 * @param identifier - An identifier of a tree from {@link parseTemplate}.
 * @returns The symbol, or undefined when the template declares no such name.
 * @throws When the identifier belongs to a tree not parsed by {@link parseTemplate}.
 */
export function symbolOf(identifier: ts.Identifier): ts.Symbol | undefined {
    const checker: ts.TypeChecker = programOf(identifier.getSourceFile()).getTypeChecker();
    return ts.isShorthandPropertyAssignment(identifier.parent) && identifier.parent.name === identifier
        ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
        : checker.getSymbolAtLocation(identifier);
}

/**
 * Whether a node is written under `declare`, which states that what it declares exists at runtime
 * without the template defining it.
 * @param node - The node.
 * @returns True when the node or a node around it carries the `declare` modifier.
 */
export function isAmbient(node: ts.Node): boolean {
    for (let current: ts.Node | undefined = node; current != undefined; current = current.parent) {
        const modifiers: readonly ts.Modifier[] = ts.canHaveModifiers(current) ? ts.getModifiers(current) ?? [] : [];
        if (modifiers.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword)) {
            return true;
        }
    }
    return false;
}

/**
 * Whether a symbol is declared inside a node, as opposed to around it, elsewhere in the template or
 * nowhere in it.
 * @param symbol - The symbol, or undefined for a name the template does not declare.
 * @param node - The node.
 * @returns True when one of the symbol's declarations lies within the node.
 */
export function isDeclaredWithin(symbol: ts.Symbol | undefined, node: ts.Node): boolean {
    return (symbol?.declarations ?? []).some(declaration => declaration.getSourceFile() === node.getSourceFile()
        && declaration.pos >= node.pos
        && declaration.end <= node.end);
}