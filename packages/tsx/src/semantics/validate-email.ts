import { findComponents } from './component';
import { EMAIL_MODULE, EmailComponentSchema, emailSchema, ZIBRI_MODULE } from './email-schema';
import { ValidationCode } from './validate';
import { childrenOf, WalkNode } from './walk';
import { Diagnostic, DiagnosticSeverity } from '../diagnostics/diagnostic.model';
import { JSXAttribute, JSXElement, JSXName, JSXSpreadAttribute, Program } from '../parser/ast';

/**
 * The email component whose children are currently being checked: its schema plus its name. Undefined
 * at the top level and inside opaque (user-component) wrappers, where the surrounding contract is
 * unknown and nesting is left to that component's own file.
 */
type Slot = EmailComponentSchema & {
    /**
     * The enclosing component's canonical name.
     */
    name: string
};

/**
 * A JSX tag that resolves to a framework email component.
 */
type EmailTag = {
    /**
     * Discriminant.
     */
    kind: 'email',
    /**
     * The canonical component name.
     */
    name: string
};

/**
 * A JSX tag that is a plain HTML element.
 */
type HostTag = {
    /**
     * Discriminant.
     */
    kind: 'host',
    /**
     * The HTML tag name.
     */
    tag: string
};

/**
 * A JSX tag that is a user component (an opaque wrapper).
 */
type UserTag = {
    /**
     * Discriminant.
     */
    kind: 'user',
    /**
     * The component name, for messages.
     */
    name: string
};

/**
 * What a JSX tag refers to.
 */
type TagKind = EmailTag | HostTag | UserTag;

/**
 * Maps each local binding to the email component it was imported as, for imports from the email
 * module. A local component of the same name that was not imported from there is absent, so it is
 * never mistaken for an email component.
 * @param program - The parsed program.
 * @returns The local-name to canonical-name map (empty when the file imports no email components).
 */
export function collectEmailImports(program: Program): Map<string, string> {
    const map: Map<string, string> = new Map<string, string>();
    for (const item of program.body) {
        if (item.kind !== 'ImportDeclaration' || item.typeOnly) {
            continue;
        }
        // The subpath exports only email components, so any binding from it counts; the main package
        // exports much more, so a binding counts only when its name is a known email component.
        const fromSubpath: boolean = item.source === EMAIL_MODULE;
        if (!fromSubpath && item.source !== ZIBRI_MODULE) {
            continue;
        }
        for (const specifier of item.specifiers) {
            if (!specifier.typeOnly && (fromSubpath || emailSchema(specifier.imported) !== undefined)) {
                map.set(specifier.local, specifier.imported);
            }
        }
    }
    return map;
}

/**
 * Whether a file is an email template, i.e. It imports at least one email component (from the subpath
 * or by name from the main package).
 * @param program - The parsed program.
 * @returns True when the file imports an email component.
 */
export function isEmailTemplate(program: Program): boolean {
    return collectEmailImports(program).size > 0;
}

/**
 * Classifies a JSX tag as an email component, a host (HTML) element, or a user component.
 * @param name - The JSX tag name.
 * @param imports - The email-import map.
 * @returns What the tag refers to.
 */
function classify(name: JSXName, imports: Map<string, string>): TagKind {
    if (name.kind !== 'JSXIdentifier') {
        return { kind: 'user', name: 'a component' };
    }
    const email: string | undefined = imports.get(name.name);
    if (email !== undefined) {
        return { kind: 'email', name: email };
    }
    // JSX treats a lowercase-initial tag as a host element and a capitalized one as a component.
    return /^[a-z]/.test(name.name) ? { kind: 'host', tag: name.name } : { kind: 'user', name: name.name };
}

/**
 * A readable name for an offending child, for the diagnostic message.
 * @param tag - The classified tag.
 * @returns The display name.
 */
function describe(tag: TagKind): string {
    switch (tag.kind) {
        case 'email':
        case 'user': {
            return `'${tag.name}'`;
        }
        case 'host': {
            return `'<${tag.tag}>'`;
        }
    }
}

/**
 * The explanation of what a slot does accept, appended to a rejection message.
 * @param slot - The enclosing component's slot.
 * @returns The explanation.
 */
function allowedExplanation(slot: Slot): string {
    switch (slot.kind) {
        case 'structural': {
            return `Valid children of '${slot.name}' are: ${slot.children.join(', ')}.`;
        }
        case 'content': {
            return `'${slot.name}' accepts text and HTML, not email components.`;
        }
        case 'text': {
            return `'${slot.name}' accepts text only.`;
        }
        case 'empty': {
            return `'${slot.name}' accepts no children.`;
        }
    }
}

/**
 * Builds a nesting diagnostic for a child a slot rejects.
 * @param child - A readable name for the child.
 * @param slot - The enclosing component's slot.
 * @param span - The offending node's location.
 * @returns The diagnostic.
 */
function reject(child: string, slot: Slot, span: Diagnostic['span']): Diagnostic {
    return {
        code: ValidationCode.ILLEGAL_EMAIL_NESTING,
        message: `${child} is not a valid child of '${slot.name}'. ${allowedExplanation(slot)}`,
        severity: DiagnosticSeverity.ERROR,
        span
    };
}

/**
 * Whether a slot accepts free text as a child.
 * @param slot - The slot.
 * @returns True for content and text slots.
 */
function acceptsText(slot: Slot): boolean {
    return slot.kind === 'content' || slot.kind === 'text';
}

/**
 * The expressions embedded in a JSX element's attributes (spread arguments and `={...}` values). A
 * JSX value there is a prop, not a child, so it is checked with no slot.
 * @param attributes - The element's attributes.
 * @returns The embedded expression nodes.
 */
function attributeExpressions(attributes: (JSXAttribute | JSXSpreadAttribute)[]): WalkNode[] {
    const out: WalkNode[] = [];
    for (const attribute of attributes) {
        if (attribute.kind === 'JSXSpreadAttribute') {
            out.push(attribute.argument);
        }
        else if (attribute.value?.kind === 'JSXExpressionContainer' && attribute.value.expression) {
            out.push(attribute.value.expression);
        }
    }
    return out;
}

/**
 * Validates an element against the slot it sits in and returns the slot its own children sit in.
 * @param element - The element.
 * @param tag - The element's classification.
 * @param slot - The slot the element sits in (undefined at the top level / inside a wrapper).
 * @param diagnostics - The accumulator to push diagnostics into.
 * @returns The slot for the element's children.
 */
function placeElement(
    element: JSXElement,
    tag: TagKind,
    slot: Slot | undefined,
    diagnostics: Diagnostic[]
): Slot | undefined {
    if (slot !== undefined && !slotAccepts(slot, tag)) {
        diagnostics.push(reject(describe(tag), slot, element.span));
    }
    if (tag.kind === 'email') {
        const schema: EmailComponentSchema = emailSchema(tag.name) ?? { kind: 'empty', children: [] };
        return { name: tag.name, kind: schema.kind, children: schema.children };
    }
    // A host element in a content slot stays transparent, so email components buried in HTML are still
    // caught; anywhere else its children are no longer judged. A user component is always opaque.
    if (tag.kind === 'host' && slot?.kind === 'content') {
        return slot;
    }
    return undefined;
}

/**
 * Whether a slot accepts a given element as a child.
 * @param slot - The enclosing slot.
 * @param tag - The child element's classification.
 * @returns True when the element is allowed.
 */
function slotAccepts(slot: Slot, tag: TagKind): boolean {
    switch (slot.kind) {
        case 'structural': {
            // Email children must be in the list; user components are opaque wrappers and allowed;
            // host elements (raw HTML) are not.
            return tag.kind === 'user' || (tag.kind === 'email' && slot.children.includes(tag.name));
        }
        case 'content': {
            // Text and HTML are fine here; only an email component is out of place.
            return tag.kind !== 'email';
        }
        case 'text':
        case 'empty': {
            return false;
        }
    }
}

/**
 * Recursively checks nesting. Non-JSX nodes are transparent control flow and keep the same slot, so a
 * component rendered inside a `.map` or a conditional is judged against the same parent.
 * @param node - The node to check.
 * @param slot - The slot the node sits in.
 * @param imports - The email-import map.
 * @param diagnostics - The accumulator to push diagnostics into.
 */
function check(node: WalkNode, slot: Slot | undefined, imports: Map<string, string>, diagnostics: Diagnostic[]): void {
    if (node.kind === 'JSXText') {
        if (slot !== undefined && !acceptsText(slot) && node.value.trim().length > 0) {
            diagnostics.push(reject('Text', slot, node.span));
        }
        return;
    }
    if (node.kind === 'JSXElement') {
        const tag: TagKind = classify(node.name, imports);
        const childSlot: Slot | undefined = placeElement(node, tag, slot, diagnostics);
        for (const expression of attributeExpressions(node.attributes)) {
            check(expression, undefined, imports, diagnostics);
        }
        for (const child of node.children) {
            check(child, childSlot, imports, diagnostics);
        }
        return;
    }
    for (const child of childrenOf(node)) {
        check(child, slot, imports, diagnostics);
    }
}

/**
 * Validates that every email component in the file is nested where the schema allows, and that no raw
 * HTML or text appears where only email components may. Only files that import email components are
 * checked; a top-level element is not judged, since a reusable partial has no visible parent.
 * @param program - The parsed program.
 * @returns The nesting diagnostics.
 */
export function validateEmailNesting(program: Program): Diagnostic[] {
    const imports: Map<string, string> = collectEmailImports(program);
    if (imports.size === 0) {
        return [];
    }
    const diagnostics: Diagnostic[] = [];
    for (const component of findComponents(program)) {
        check(component.fn.body, undefined, imports, diagnostics);
    }
    return diagnostics;
}

/**
 * Rejects an email template that carries client-only code. Emails are static server-rendered HTML
 * with no script, so an `onClient` block, an event handler or a `?client` import can never run and
 * is almost certainly a mistake.
 * @param program - The parsed program.
 * @param hasClientBehavior - Whether the compiled component emitted a client setup.
 * @param clientPackages - The `?client` packages the file imports.
 * @returns The diagnostics (empty when the file is not an email or has no client code).
 */
export function validateNoClientInEmail(
    program: Program,
    hasClientBehavior: boolean,
    clientPackages: string[]
): Diagnostic[] {
    if (!isEmailTemplate(program) || (!hasClientBehavior && clientPackages.length === 0)) {
        return [];
    }
    const components: ReturnType<typeof findComponents> = findComponents(program);
    const span: Diagnostic['span'] = components[0]?.fn.span ?? { start: 0, end: 0 };
    return [
        {
            code: ValidationCode.CLIENT_CODE_IN_EMAIL,
            message: 'This email template contains client-only code (an onClient block, an event handler, or a '
                + '?client import). Emails render to static HTML with no script, so client code can never run - '
                + 'remove it, or render this as a page instead of an email.',
            severity: DiagnosticSeverity.ERROR,
            span
        }
    ];
}