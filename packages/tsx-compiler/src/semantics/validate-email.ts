import ts from 'typescript';
import { Diagnostic, DiagnosticSeverity } from 'zibri-tsx';

import { ComponentFunction, ComponentInfo, findComponents } from './component';
import { EMAIL_MODULE, EmailComponentSchema, emailSchema, ZIBRI_MODULE } from './email-schema';
import { readImports } from './imports';
import { spanOf, ValidationCode } from './validate';
import { childrenOf, unwrapTypeSyntax } from './walk';

/**
 * The email component whose children are currently being checked: its schema, its name, and the element of the
 * checked template it is reached through.
 */
type Slot = EmailComponentSchema & {
    /**
     * The enclosing component's canonical name.
     */
    name: string,
    /**
     * The element of the checked template the slot is reached through: the email component itself, or the use of
     * the user component that renders it.
     */
    anchor: ts.Node,
    /**
     * The user component of the checked template that places content into the slot, when it is one that renders it.
     */
    placer: string | undefined
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
 * A JSX tag that is a user component.
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
 * A JSX element, with or without children.
 */
type JsxElementLike = ts.JsxElement | ts.JsxSelfClosingElement;

/**
 * A user component a JSX tag renders, found in the file it is declared in.
 */
export type ResolvedEmailComponent = {
    /**
     * The component.
     */
    component: ComponentInfo,
    /**
     * The file declaring it.
     */
    file: ts.SourceFile
};

/**
 * Finds the user component a JSX tag renders, or nothing when it cannot be followed: a component of a library, or one
 * of another file when only one file is checked.
 */
export type EmailComponentResolver = (tag: ts.JsxTagNameExpression, file: ts.SourceFile) => ResolvedEmailComponent | undefined;

/**
 * What the caller of a component passed as one of its props, checked as the caller's code where the component places it.
 */
type PlacedProp = {
    /**
     * The node the caller passed.
     */
    node: ts.Node,
    /**
     * The component the caller's node is part of.
     */
    frame: Frame
};

/**
 * One component whose body is being checked: on its own, or as one use of it in the checked template renders it.
 */
type Frame = {
    /**
     * The file declaring the component.
     */
    file: ts.SourceFile,
    /**
     * The email imports of that file.
     */
    imports: Map<string, string>,
    /**
     * The component.
     */
    component: ComponentInfo,
    /**
     * What the use being followed passes the component, by prop. Undefined for a component checked on its own.
     */
    props: Map<string, PlacedProp[]> | undefined,
    /**
     * The use of a user component in the checked template this component is reached through, undefined for a component
     * of the checked template checked on its own.
     */
    anchor: ts.Node | undefined,
    /**
     * The slot the component's use sits in, which what it returns is judged against.
     */
    rootSlot: Slot | undefined,
    /**
     * The components being followed on the way here, which are not followed again.
     */
    expanding: ReadonlySet<ComponentFunction>
};

/**
 * The state of one check of a template.
 */
type EmailWalk = {
    /**
     * Finds the user component a tag renders.
     */
    resolve: EmailComponentResolver,
    /**
     * The email imports of each file met, read once.
     */
    imports: Map<ts.SourceFile, Map<string, string>>,
    /**
     * The locals being followed, which are not followed again.
     */
    followingLocals: Set<ts.Node>,
    /**
     * The diagnostics found, by where they are and what they say, so one reached twice is reported once.
     */
    diagnostics: Map<string, Diagnostic>
};

/**
 * Maps each local binding to the email component it was imported as, for imports from the email
 * module. A local component of the same name that was not imported from there is absent, so it is
 * never mistaken for an email component.
 * @param file - The parsed template.
 * @returns The local-name to canonical-name map (empty when the file imports no email components).
 */
export function collectEmailImports(file: ts.SourceFile): Map<string, string> {
    const map: Map<string, string> = new Map<string, string>();
    for (const item of readImports(file)) {
        if (item.typeOnly) {
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
 * @param file - The parsed template.
 * @returns True when the file imports an email component.
 */
export function isEmailTemplate(file: ts.SourceFile): boolean {
    return collectEmailImports(file).size > 0;
}

/**
 * The tag name of a JSX element.
 * @param element - The element.
 * @returns Its tag name expression.
 */
export function tagNameOf(element: JsxElementLike): ts.JsxTagNameExpression {
    return ts.isJsxElement(element) ? element.openingElement.tagName : element.tagName;
}

/**
 * Finds the components declared in the file a tag is in, by their name. A name the file imports is another file's,
 * which a check of one file cannot follow.
 * @returns The resolver.
 */
export function resolveSameFileComponents(): EmailComponentResolver {
    const declared: Map<ts.SourceFile, Map<string, ComponentInfo>> = new Map();
    return (tag, file) => {
        if (!ts.isIdentifier(tag)) {
            return undefined;
        }
        let components: Map<string, ComponentInfo> | undefined = declared.get(file);
        if (components === undefined) {
            const imported: Set<string> = new Set(readImports(file).flatMap(item => [
                ...item.defaultImport === undefined ? [] : [item.defaultImport],
                ...item.namespaceImport === undefined ? [] : [item.namespaceImport],
                ...item.specifiers.map(specifier => specifier.local)
            ]));
            components = new Map(findComponents(file).filter(component => !component.isDefault && !imported.has(component.name))
                .map(component => [component.name, component]));
            declared.set(file, components);
        }
        const component: ComponentInfo | undefined = components.get(tag.text);
        return component === undefined ? undefined : { component, file };
    };
}

/**
 * Finds the component a tag renders through the type checker of a whole program, in whichever file of the program
 * declares it. A component of a declaration file, as one of a library, is not followed.
 * @param checker - The type checker of the program.
 * @returns The resolver.
 */
export function resolveProgramComponents(checker: ts.TypeChecker): EmailComponentResolver {
    const declared: Map<ts.SourceFile, ComponentInfo[]> = new Map();
    return tag => {
        const symbol: ts.Symbol | undefined = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(tag) ? tag.name : tag);
        const target: ts.Symbol | undefined = symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0
            ? checker.getAliasedSymbol(symbol)
            : symbol;
        const declaration: ts.Declaration | undefined = target?.valueDeclaration ?? target?.declarations?.[0];
        if (declaration === undefined || declaration.getSourceFile().isDeclarationFile) {
            return undefined;
        }
        const fn: ts.Node | undefined = declaredFunction(declaration);
        const file: ts.SourceFile = declaration.getSourceFile();
        let components: ComponentInfo[] | undefined = declared.get(file);
        if (components === undefined) {
            components = findComponents(file);
            declared.set(file, components);
        }
        const component: ComponentInfo | undefined = components.find(candidate => candidate.fn === fn);
        return component === undefined ? undefined : { component, file };
    };
}

/**
 * The function a declaration declares, as `findComponents` finds it.
 * @param declaration - The declaration.
 * @returns The function, or the declaration itself when it declares none.
 */
function declaredFunction(declaration: ts.Declaration): ts.Node {
    if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
        return unwrapTypeSyntax(declaration.initializer);
    }
    return ts.isExportAssignment(declaration) ? unwrapTypeSyntax(declaration.expression) : declaration;
}

/**
 * Classifies a JSX tag as an email component, a host (HTML) element, or a user component.
 * @param name - The JSX tag name.
 * @param imports - The email-import map.
 * @returns What the tag refers to.
 */
function classify(name: ts.JsxTagNameExpression, imports: Map<string, string>): TagKind {
    if (ts.isPropertyAccessExpression(name)) {
        return { kind: 'user', name: name.getText() };
    }
    // `this` and a namespaced name (`svg:circle`) are classified by the name they were written with
    const written: string = ts.isIdentifier(name) ? name.text : name.getText();
    const email: string | undefined = imports.get(written);
    if (email !== undefined) {
        return { kind: 'email', name: email };
    }
    // JSX treats a lowercase-initial tag as a host element and a capitalized one as a component.
    return /^[a-z]/.test(written) ? { kind: 'host', tag: written } : { kind: 'user', name: written };
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
 * The name a JSX element is written with.
 * @param node - The element.
 * @returns Its tag as written.
 */
function writtenTag(node: ts.Node): string {
    return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) ? tagNameOf(node).getText() : node.getText();
}

/**
 * Reports a child a slot rejects, at the element of the checked template it is reached through. A child and a slot
 * both reached through the same use of a user component are inside that component, whose own file reports them.
 * @param node - The child.
 * @param child - A readable name for the child.
 * @param slot - The slot that rejects it.
 * @param frame - The component the child is part of.
 * @param walk - The check.
 */
function reject(node: ts.Node, child: string, slot: Slot, frame: Frame, walk: EmailWalk): void {
    const anchor: ts.Node = frame.anchor ?? node;
    if (anchor === slot.anchor) {
        return;
    }
    const subject: string = frame.anchor === undefined
        ? child
        : `'${writtenTag(frame.anchor)}' renders ${child === 'Text' ? 'text' : child}, which`;
    const where: string = slot.placer === undefined ? '' : `, where '${slot.placer}' places it`;
    // TODO 4.0: an error, like nesting written out. A mistake reached through a user component is a warning, as such
    // a template compiled in 3.0
    const throughComponent: boolean = frame.anchor !== undefined || slot.placer !== undefined;
    const diagnostic: Diagnostic = {
        code: ValidationCode.ILLEGAL_EMAIL_NESTING,
        message: `${subject} is not a valid child of '${slot.name}'${where}. ${allowedExplanation(slot)}`
            + (throughComponent ? ' This fails the build from 4.0.' : ''),
        severity: throughComponent ? DiagnosticSeverity.WARNING : DiagnosticSeverity.ERROR,
        span: spanOf(anchor)
    };
    walk.diagnostics.set(`${diagnostic.span.start}:${diagnostic.span.end}:${diagnostic.message}`, diagnostic);
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
 * @param element - The element.
 * @returns The embedded expression nodes.
 */
function attributeExpressions(element: JsxElementLike): ts.Node[] {
    const attributes: ts.JsxAttributes = ts.isJsxElement(element) ? element.openingElement.attributes : element.attributes;
    const out: ts.Node[] = [];
    for (const attribute of attributes.properties) {
        if (ts.isJsxSpreadAttribute(attribute)) {
            out.push(attribute.expression);
        }
        else if (attribute.initializer != undefined && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
            out.push(attribute.initializer.expression);
        }
    }
    return out;
}

/**
 * What a use of a user component passes it, by prop: the value of each attribute, and its children as `children`.
 * @param element - The use.
 * @param frame - The component the use is part of.
 * @returns The props passed.
 */
function propsPassedBy(element: JsxElementLike, frame: Frame): Map<string, PlacedProp[]> {
    const props: Map<string, PlacedProp[]> = new Map();
    const attributes: ts.JsxAttributes = ts.isJsxElement(element) ? element.openingElement.attributes : element.attributes;
    for (const attribute of attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name) || attribute.initializer === undefined) {
            continue;
        }
        const initializer: ts.JsxAttributeValue = attribute.initializer;
        const node: ts.Node | undefined = ts.isJsxExpression(initializer)
            ? initializer.expression
            : ts.isStringLiteral(initializer) ? undefined : initializer;
        if (node !== undefined) {
            props.set(attribute.name.text, [{ node, frame }]);
        }
    }
    if (ts.isJsxElement(element) && element.children.length > 0) {
        props.set('children', element.children.map(node => ({ node, frame })));
    }
    return props;
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
            // Email children must be in the list; a user component is judged by what it renders; host elements (raw
            // HTML) are not allowed.
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
 * Checks an element against the slot it sits in, and its children against the slot it gives them. A user component
 * the check can follow is checked as this use renders it: what it returns against this slot, and what this use
 * passes it where it places it.
 * @param element - The element.
 * @param slot - The slot the element sits in (undefined at the top level / inside an element that is not judged).
 * @param frame - The component the element is part of.
 * @param walk - The check.
 */
function checkElement(element: JsxElementLike, slot: Slot | undefined, frame: Frame, walk: EmailWalk): void {
    const tag: TagKind = classify(tagNameOf(element), frame.imports);
    const accepted: boolean = slot === undefined || slotAccepts(slot, tag);
    if (slot !== undefined && !accepted) {
        reject(element, describe(tag), slot, frame, walk);
    }
    for (const expression of attributeExpressions(element)) {
        check(expression, undefined, frame, walk);
    }
    const children: readonly ts.JsxChild[] = ts.isJsxElement(element) ? element.children : [];
    switch (tag.kind) {
        case 'email': {
            validateEmailComponentChildren(element, tag.name, children, frame, walk);
            return;
        }
        case 'host': {
            // A host element in a content slot stays transparent, so email components buried in HTML are still
            // caught; anywhere else its children are no longer judged.
            for (const child of children) {
                check(child, slot?.kind === 'content' ? slot : undefined, frame, walk);
            }
            return;
        }
        case 'user': {
            // a use the slot already rejected is reported once, not again for what it renders
            validateUserComponentUse(element, accepted ? slot : undefined, children, frame, walk);
            return;
        }
    }
}

/**
 * Checks the children of an email component against the slot its schema gives them.
 * @param element - The email component's element.
 * @param name - The email component.
 * @param children - The element's children.
 * @param frame - The component the element is part of.
 * @param walk - The check.
 */
function validateEmailComponentChildren(
    element: JsxElementLike,
    name: string,
    children: readonly ts.JsxChild[],
    frame: Frame,
    walk: EmailWalk
): void {
    const schema: EmailComponentSchema = emailSchema(name) ?? { kind: 'empty', children: [] };
    const childSlot: Slot = {
        ...schema,
        name,
        anchor: frame.anchor ?? element,
        placer: frame.anchor === undefined ? undefined : writtenTag(frame.anchor)
    };
    for (const child of children) {
        check(child, childSlot, frame, walk);
    }
}

/**
 * Checks a use of a user component: what the component renders as this use renders it, when the check can follow
 * it, and what the use passes it on its own.
 * @param element - The use.
 * @param rootSlot - The slot what the component returns is checked against.
 * @param children - The use's children.
 * @param frame - The component the use is part of.
 * @param walk - The check.
 */
function validateUserComponentUse(
    element: JsxElementLike,
    rootSlot: Slot | undefined,
    children: readonly ts.JsxChild[],
    frame: Frame,
    walk: EmailWalk
): void {
    const resolved: ResolvedEmailComponent | undefined = walk.resolve(tagNameOf(element), frame.file);
    if (resolved !== undefined && !frame.expanding.has(resolved.component.fn)) {
        checkComponent({
            file: resolved.file,
            imports: importsOf(resolved.file, walk),
            component: resolved.component,
            props: propsPassedBy(element, frame),
            anchor: frame.anchor ?? element,
            rootSlot,
            expanding: new Set([...frame.expanding, resolved.component.fn])
        }, walk);
    }
    // what the use passes is checked on its own as well, also when the component never places it
    for (const child of children) {
        check(child, undefined, frame, walk);
    }
}

/**
 * Recursively checks nesting. Non-JSX nodes are transparent control flow and keep the same slot, so a
 * component rendered inside a `.map` or a conditional is judged against the same parent.
 * @param node - The node to check.
 * @param slot - The slot the node sits in.
 * @param frame - The component the node is part of.
 * @param walk - The check.
 */
function check(node: ts.Node, slot: Slot | undefined, frame: Frame, walk: EmailWalk): void {
    if (ts.isJsxText(node)) {
        if (slot !== undefined && !acceptsText(slot) && node.text.trim().length > 0) {
            reject(node, 'Text', slot, frame, walk);
        }
        return;
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        checkElement(node, slot, frame, walk);
        return;
    }
    if (
        ts.isReturnStatement(node)
        && node.expression !== undefined
        && ts.findAncestor(node.parent, ts.isFunctionLike) === frame.component.fn
    ) {
        checkPlaced(node.expression, frame.rootSlot, frame, walk);
        return;
    }
    if (ts.isJsxExpression(node) && node.expression !== undefined) {
        checkPlaced(node.expression, slot, frame, walk);
        return;
    }
    for (const child of childrenOf(node)) {
        check(child, slot, frame, walk);
    }
}

/**
 * Checks an expression placed into a slot: the JSX in it against the slot, and what a prop or a local it places
 * holds as well.
 * @param node - The expression.
 * @param slot - The slot it is placed into.
 * @param frame - The component the expression is part of.
 * @param walk - The check.
 */
function checkPlaced(node: ts.Node, slot: Slot | undefined, frame: Frame, walk: EmailWalk): void {
    check(node, slot, frame, walk);
    if (slot === undefined) {
        return;
    }
    for (const leaf of placedValues(node)) {
        const prop: string | undefined = findPlacedProp(leaf, frame.component.fn);
        if (prop !== undefined) {
            for (const passed of frame.props?.get(prop) ?? []) {
                checkPlaced(passed.node, slot, passed.frame, walk);
            }
            continue;
        }
        const local: ts.Expression | undefined = findLocalValue(leaf, frame.component.fn);
        if (local !== undefined && !walk.followingLocals.has(local)) {
            walk.followingLocals.add(local);
            checkPlaced(local, slot, frame, walk);
            walk.followingLocals.delete(local);
        }
    }
}

/**
 * The expressions whose value an expression places: itself, or what a conditional, a logical operator, a comma or an
 * array yields.
 * @param node - The expression.
 * @returns The expressions placed.
 */
function placedValues(node: ts.Node): ts.Node[] {
    const expression: ts.Node = ts.isExpression(node) ? unwrapTypeSyntax(node) : node;
    if (ts.isParenthesizedExpression(expression)) {
        return placedValues(expression.expression);
    }
    if (ts.isConditionalExpression(expression)) {
        return [...placedValues(expression.whenTrue), ...placedValues(expression.whenFalse)];
    }
    if (ts.isBinaryExpression(expression)) {
        switch (expression.operatorToken.kind) {
            case ts.SyntaxKind.AmpersandAmpersandToken:
            case ts.SyntaxKind.CommaToken: {
                return placedValues(expression.right);
            }
            case ts.SyntaxKind.BarBarToken:
            case ts.SyntaxKind.QuestionQuestionToken: {
                return [...placedValues(expression.left), ...placedValues(expression.right)];
            }
            // an assignment, arithmetic, a comparison or a bitwise operator yields the expression itself
            case ts.SyntaxKind.EqualsToken:
            case ts.SyntaxKind.PlusEqualsToken:
            case ts.SyntaxKind.MinusEqualsToken:
            case ts.SyntaxKind.AsteriskEqualsToken:
            case ts.SyntaxKind.AsteriskAsteriskEqualsToken:
            case ts.SyntaxKind.SlashEqualsToken:
            case ts.SyntaxKind.PercentEqualsToken:
            case ts.SyntaxKind.AmpersandEqualsToken:
            case ts.SyntaxKind.BarEqualsToken:
            case ts.SyntaxKind.CaretEqualsToken:
            case ts.SyntaxKind.LessThanLessThanEqualsToken:
            case ts.SyntaxKind.GreaterThanGreaterThanEqualsToken:
            case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken:
            case ts.SyntaxKind.AmpersandAmpersandEqualsToken:
            case ts.SyntaxKind.BarBarEqualsToken:
            case ts.SyntaxKind.QuestionQuestionEqualsToken:
            case ts.SyntaxKind.PlusToken:
            case ts.SyntaxKind.MinusToken:
            case ts.SyntaxKind.AsteriskToken:
            case ts.SyntaxKind.AsteriskAsteriskToken:
            case ts.SyntaxKind.SlashToken:
            case ts.SyntaxKind.PercentToken:
            case ts.SyntaxKind.AmpersandToken:
            case ts.SyntaxKind.BarToken:
            case ts.SyntaxKind.CaretToken:
            case ts.SyntaxKind.LessThanLessThanToken:
            case ts.SyntaxKind.GreaterThanGreaterThanToken:
            case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
            case ts.SyntaxKind.EqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsEqualsToken:
            case ts.SyntaxKind.ExclamationEqualsToken:
            case ts.SyntaxKind.ExclamationEqualsEqualsToken:
            case ts.SyntaxKind.LessThanToken:
            case ts.SyntaxKind.LessThanEqualsToken:
            case ts.SyntaxKind.GreaterThanToken:
            case ts.SyntaxKind.GreaterThanEqualsToken:
            case ts.SyntaxKind.InKeyword:
            case ts.SyntaxKind.InstanceOfKeyword: {
                return [expression];
            }
        }
    }
    return ts.isArrayLiteralExpression(expression)
        ? expression.elements.flatMap(element => placedValues(ts.isSpreadElement(element) ? element.expression : element))
        : [expression];
}

/**
 * The prop of a component an expression reads as a whole: a name its props are destructured into, or `props.name`.
 * @param node - The expression.
 * @param fn - The component.
 * @returns The prop's name, or undefined when the expression reads none.
 */
function findPlacedProp(node: ts.Node, fn: ComponentFunction): string | undefined {
    const parameter: ts.ParameterDeclaration | undefined = fn.parameters[0];
    if (parameter === undefined) {
        return undefined;
    }
    const pattern: ts.BindingName = parameter.name;
    if (ts.isIdentifier(node) && ts.isObjectBindingPattern(pattern)) {
        const element: ts.BindingElement | undefined = pattern.elements.find(candidate => candidate.dotDotDotToken === undefined
            && ts.isIdentifier(candidate.name) && candidate.name.text === node.text);
        return element === undefined ? undefined : propertyNameOf(element);
    }
    if (!ts.isPropertyAccessExpression(node) || !ts.isIdentifier(node.expression)) {
        return undefined;
    }
    const object: string = node.expression.text;
    // `props.children`, or `rest.children` of `({ title, ...rest })`
    const readsProps: boolean = ts.isIdentifier(pattern)
        ? pattern.text === object
        : ts.isObjectBindingPattern(pattern) && pattern.elements.some(element => element.dotDotDotToken !== undefined
            && ts.isIdentifier(element.name) && element.name.text === object);
    return readsProps ? node.name.text : undefined;
}

/**
 * The prop a destructured binding reads.
 * @param element - The binding.
 * @returns The prop's name, or undefined for a computed one.
 */
function propertyNameOf(element: ts.BindingElement): string | undefined {
    const name: ts.PropertyName | undefined = element.propertyName;
    if (name === undefined) {
        return ts.isIdentifier(element.name) ? element.name.text : undefined;
    }
    return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/**
 * The value of a `const` of a component's body an expression names.
 * @param node - The expression.
 * @param fn - The component.
 * @returns The value, or undefined when the expression names no such `const`.
 */
function findLocalValue(node: ts.Node, fn: ComponentFunction): ts.Expression | undefined {
    if (!ts.isIdentifier(node) || fn.body === undefined || !ts.isBlock(fn.body)) {
        return undefined;
    }
    for (const statement of fn.body.statements) {
        if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
            continue;
        }
        const declaration: ts.VariableDeclaration | undefined = statement.declarationList.declarations
            .find(candidate => ts.isIdentifier(candidate.name) && candidate.name.text === node.text);
        if (declaration?.initializer !== undefined) {
            return declaration.initializer;
        }
    }
    return undefined;
}

/**
 * Checks the body of a component: what it returns against the slot its use sits in, and everything else on its own.
 * @param frame - The component.
 * @param walk - The check.
 */
function checkComponent(frame: Frame, walk: EmailWalk): void {
    const body: ts.ConciseBody | undefined = frame.component.fn.body;
    if (body === undefined) {
        return;
    }
    if (ts.isBlock(body)) {
        check(body, undefined, frame, walk);
        return;
    }
    checkPlaced(body, frame.rootSlot, frame, walk);
}

/**
 * The email imports of a file, read once per check.
 * @param file - The file.
 * @param walk - The check.
 * @returns The imports.
 */
function importsOf(file: ts.SourceFile, walk: EmailWalk): Map<string, string> {
    let imports: Map<string, string> | undefined = walk.imports.get(file);
    if (imports === undefined) {
        imports = collectEmailImports(file);
        walk.imports.set(file, imports);
    }
    return imports;
}

/**
 * Checks every component of a file, following the user components the resolver finds.
 * @param file - The parsed template.
 * @param resolve - Finds the user component a tag renders.
 * @returns The nesting diagnostics.
 */
function checkFile(file: ts.SourceFile, resolve: EmailComponentResolver): Diagnostic[] {
    const walk: EmailWalk = { resolve, imports: new Map(), followingLocals: new Set(), diagnostics: new Map() };
    for (const component of findComponents(file)) {
        checkComponent({
            file,
            imports: importsOf(file, walk),
            component,
            props: undefined,
            anchor: undefined,
            rootSlot: undefined,
            // a component that renders itself is followed into once, which shows what its own use renders
            expanding: new Set()
        }, walk);
    }
    return [...walk.diagnostics.values()].sort((a, b) => a.span.start - b.span.start);
}

/**
 * Validates that every email component in the file is nested where the schema allows, and that no raw
 * HTML or text appears where only email components may. Only files that import email components are
 * checked; a top-level element is not judged, since a reusable partial has no visible parent. A user component
 * declared in the same file is judged by what it renders; one of another file is left to
 * {@link validateEmailComposition}, which reads the whole program.
 * @param file - The parsed template.
 * @returns The nesting diagnostics.
 */
export function validateEmailNesting(file: ts.SourceFile): Diagnostic[] {
    return collectEmailImports(file).size === 0 ? [] : checkFile(file, resolveSameFileComponents());
}

/**
 * Validates the nesting a template reaches through the user components of other files: what such a component renders
 * against the slot its use sits in, and what the use passes it where the component places it. Reports only what
 * {@link validateEmailNesting} of the file alone cannot see, so a mistake is not reported twice.
 * @param file - The template, a file of the program the checker belongs to.
 * @param checker - The type checker of the program.
 * @returns The nesting diagnostics.
 */
export function validateEmailComposition(file: ts.SourceFile, checker: ts.TypeChecker): Diagnostic[] {
    const own: Set<string> = new Set(validateEmailNesting(file).map(diagnostic => `${diagnostic.span.start}:${diagnostic.message}`));
    return checkFile(file, resolveProgramComponents(checker))
        .filter(diagnostic => !own.has(`${diagnostic.span.start}:${diagnostic.message}`));
}

/**
 * Rejects an email template that carries client-only code. Emails are static server-rendered HTML
 * with no script, so an `onClient` block, an event handler or a `?client` import can never run and
 * is almost certainly a mistake.
 * @param file - The parsed template.
 * @param hasClientBehavior - Whether the compiled component emitted a client setup.
 * @param clientPackages - The `?client` packages the file imports.
 * @returns The diagnostics (empty when the file is not an email or has no client code).
 */
export function validateNoClientInEmail(
    file: ts.SourceFile,
    hasClientBehavior: boolean,
    clientPackages: string[]
): Diagnostic[] {
    if (!isEmailTemplate(file) || (!hasClientBehavior && clientPackages.length === 0)) {
        return [];
    }
    const components: ComponentInfo[] = findComponents(file);
    const span: Diagnostic['span'] = components.length > 0 ? spanOf(components[0].fn) : { start: 0, end: 0 };
    return [
        {
            code: ValidationCode.CLIENT_CODE_IN_EMAIL,
            // eslint-disable-next-line stylistic/max-len
            message: 'This email template contains client-only code (an onClient block, an event handler, a ref, a state, an input, an effect or a '
                + '?client import). Emails render to static HTML with no script, so client code can never run - '
                + 'remove it, or render this as a page instead of an email.',
            severity: DiagnosticSeverity.ERROR,
            span
        }
    ];
}