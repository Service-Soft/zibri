import { ComponentInfo, findComponents } from './component';
import { Diagnostic, DiagnosticSeverity } from '../diagnostics/diagnostic.model';
import { Program } from '../parser/ast';

/**
 * Diagnostic codes produced by dialect validation.
 */
export enum ValidationCode {
    /**
     * A component declared more than one parameter.
     */
    MULTIPLE_PARAMS = 'ZTSX001',
    /**
     * A component was declared async.
     */
    ASYNC_COMPONENT = 'ZTSX002',
    /**
     * Client code referenced a binding from an ordinary import.
     */
    SERVER_IMPORT_IN_CLIENT_CODE = 'ZTSX003',
    /**
     * An email component was nested somewhere the schema does not allow.
     */
    ILLEGAL_EMAIL_NESTING = 'ZTSX004',
    /**
     * An email template contains client-only code, which emails cannot run.
     */
    CLIENT_CODE_IN_EMAIL = 'ZTSX005'
}

/**
 * Validates a parsed module against the supported component dialect, returning located
 * diagnostics. The rules mirror the runtime contract: a component takes a single props object and
 * may not be async.
 * @param program - The parsed program.
 * @returns The diagnostics found (empty when the module is valid).
 */
export function validate(program: Program): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const component of findComponents(program)) {
        validateComponent(component, diagnostics);
    }
    return diagnostics;
}

/**
 * Applies the component rules to a single component, pushing any diagnostics.
 * @param component - The component to validate.
 * @param diagnostics - The accumulator to push diagnostics into.
 */
function validateComponent(component: ComponentInfo, diagnostics: Diagnostic[]): void {
    const { fn, name } = component;

    if (fn.async) {
        diagnostics.push({
            code: ValidationCode.ASYNC_COMPONENT,
            message: `Component '${name}' is async. Components must be synchronous — fetch async data before `
                + 'rendering and pass it in as props.',
            severity: DiagnosticSeverity.ERROR,
            span: fn.span
        });
    }

    if (fn.params.length > 1) {
        diagnostics.push({
            code: ValidationCode.MULTIPLE_PARAMS,
            message: `Component '${name}' has ${fn.params.length} parameters. Components must accept a single `
                + 'props object — change the signature to ({ ... }: Props) or (props: Props).',
            severity: DiagnosticSeverity.ERROR,
            span: fn.span
        });
    }
}

/**
 * Rejects client code that reads an ordinary import. Only two things cross into the browser: the
 * props a parent passes and the browser globals a `?client` import provides. An ordinary import
 * lives in the server module, which the client script — plain text in the page — cannot reach, so
 * the identifier would silently be undefined at runtime.
 * @param program - The parsed program.
 * @param referencedIdentifiers - Every identifier the emitted client code references.
 * @param providedByFramework - Names the compiler inlines into the client script itself (the
 * framework hooks), which are imported from `zibri` but never read from the module at runtime.
 * @returns The diagnostics found (empty when no client code reads an import).
 */
export function validateClientImports(
    program: Program,
    referencedIdentifiers: string[],
    providedByFramework: readonly string[]
): Diagnostic[] {
    const provided: Set<string> = new Set(providedByFramework);
    const referenced: Set<string> = new Set(referencedIdentifiers.filter(name => !provided.has(name)));
    const diagnostics: Diagnostic[] = [];

    for (const item of program.body) {
        if (item.kind !== 'ImportDeclaration' || item.client || item.typeOnly) {
            continue;
        }
        const bindings: string[] = [
            ...item.specifiers.filter(specifier => !specifier.typeOnly).map(specifier => specifier.local),
            ...item.defaultImport ? [item.defaultImport] : [],
            ...item.namespaceImport ? [item.namespaceImport] : []
        ];
        for (const binding of bindings.filter(name => referenced.has(name))) {
            diagnostics.push({
                code: ValidationCode.SERVER_IMPORT_IN_CLIENT_CODE,
                message: `'${binding}' is imported from '${item.source}' and used in client code, where it does not `
                    + `exist. Pass what you need in as a prop, or - if '${item.source}' is a browser package - import `
                    + `it as '${item.source}?client' so the vendor bundle provides it.`,
                severity: DiagnosticSeverity.ERROR,
                span: item.span
            });
        }
    }
    return diagnostics;
}