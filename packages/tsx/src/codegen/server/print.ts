import { normalizeJsxText } from './jsx-text';
import { ArrowFunctionExpression, BlockStatement, Expression, FunctionExpression, JSXAttribute, JSXChild,
    JSXElement, JSXFragment, JSXName, JSXSpreadAttribute, ObjectMember, ObjectPattern,
    ObjectPatternProperty, Pattern, Statement, TemplateLiteral, VariableDeclaration } from '../../parser/ast';
import { escapeAttribute, escapeText, VOID_ELEMENTS } from '../../runtime/server-runtime';
import { ClientPropSite } from '../client/client-props';
import { HandlerSite } from '../client/handlers';

/**
 * Name of the injected server-runtime helper namespace referenced by generated code.
 */
export const SSR: string = '$ssr';

/**
 * The handler-site map for the current server-render compilation. When set, host elements whose
 * `on*` handlers appear in the map are stamped with a `data-ssr-handlers` attribute. Codegen is
 * synchronous, so a module-scoped compile session is safe.
 */
let handlerStampMap: Map<Expression, HandlerSite> | undefined;

/**
 * The client-prop site map for the current server-render compilation. When set, matching props on
 * component elements are emitted as a reference instead of the function value itself.
 */
let clientPropMap: Map<Expression, ClientPropSite> | undefined;

/**
 * Begins a server-render compile session that stamps handler sites onto host elements and replaces
 * function props on component elements with client-prop references.
 * @param handlers - Handler-site lookup keyed by handler expression node.
 * @param clientProps - Client-prop site lookup keyed by prop value expression node.
 */
export function beginHandlerStamping(
    handlers: Map<Expression, HandlerSite>,
    clientProps: Map<Expression, ClientPropSite> = new Map<Expression, ClientPropSite>()
): void {
    handlerStampMap = handlers;
    clientPropMap = clientProps;
}

/**
 * Ends the current handler-stamping session.
 */
export function endHandlerStamping(): void {
    handlerStampMap = undefined;
    clientPropMap = undefined;
}

/**
 * Prints an expression node back to JavaScript source, lowering any embedded JSX to
 * HTML-string-building calls against the {@link SSR} runtime.
 * @param expr - The expression to print.
 * @returns The JavaScript source.
 */
export function printExpression(expr: Expression): string {
    switch (expr.kind) {
        case 'Identifier': {
            return expr.name;
        }
        case 'NumericLiteral': {
            return expr.raw;
        }
        case 'StringLiteral': {
            return expr.raw;
        }
        case 'BooleanLiteral': {
            return expr.value ? 'true' : 'false';
        }
        case 'NullLiteral': {
            return 'null';
        }
        case 'RegexLiteral': {
            return expr.raw;
        }
        case 'ThisExpression': {
            return 'this';
        }
        case 'TemplateLiteral': {
            return printTemplate(expr);
        }
        case 'TaggedTemplateExpression': {
            return `${printExpression(expr.tag)}${printTemplate(expr.quasi)}`;
        }
        case 'ArrayExpression': {
            return `[${expr.elements.map(e => e === null ? '' : printExpression(e)).join(', ')}]`;
        }
        case 'ObjectExpression': {
            return `{ ${expr.properties.map(printObjectMember).join(', ')} }`;
        }
        case 'SpreadElement': {
            return `...${printExpression(expr.argument)}`;
        }
        case 'ArrowFunctionExpression': {
            return printArrow(expr);
        }
        case 'FunctionExpression': {
            return printFunctionExpression(expr);
        }
        case 'UnaryExpression': {
            return `${expr.operator} ${printExpression(expr.argument)}`;
        }
        case 'UpdateExpression': {
            return expr.prefix
                ? `${expr.operator}${printExpression(expr.argument)}`
                : `${printExpression(expr.argument)}${expr.operator}`;
        }
        case 'BinaryExpression':
        case 'LogicalExpression': {
            return `${printExpression(expr.left)} ${expr.operator} ${printExpression(expr.right)}`;
        }
        case 'AssignmentExpression': {
            return `${printExpression(expr.left)} ${expr.operator} ${printExpression(expr.right)}`;
        }
        case 'ConditionalExpression': {
            return `${printExpression(expr.test)} ? ${printExpression(expr.consequent)} : ${printExpression(expr.alternate)}`;
        }
        case 'CallExpression': {
            return `${printExpression(expr.callee)}${expr.optional ? '?.' : ''}(${expr.arguments.map(printExpression).join(', ')})`;
        }
        case 'NewExpression': {
            return `new ${printExpression(expr.callee)}(${expr.arguments.map(printExpression).join(', ')})`;
        }
        case 'MemberExpression': {
            return printMember(expr);
        }
        case 'ParenthesizedExpression': {
            return `(${printExpression(expr.expression)})`;
        }
        case 'SequenceExpression': {
            return expr.expressions.map(printExpression).join(', ');
        }
        case 'JSXElement': {
            return lowerJsxElement(expr);
        }
        case 'JSXFragment': {
            return lowerJsxFragment(expr);
        }
        default: {
            return '';
        }
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
function printMember(expr: Extract<Expression, { kind: 'MemberExpression' }>): string {
    const object: string = printExpression(expr.object);
    if (expr.computed) {
        return `${object}${expr.optional ? '?.' : ''}[${printExpression(expr.property)}]`;
    }
    return `${object}${expr.optional ? '?.' : '.'}${printExpression(expr.property)}`;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function printObjectMember(member: ObjectMember): string {
    if (member.kind === 'SpreadElement') {
        return `...${printExpression(member.argument)}`;
    }
    if (member.shorthand) {
        return printExpression(member.value);
    }
    const key: string = member.computed ? `[${printExpression(member.key)}]` : printExpression(member.key);
    return `${key}: ${printExpression(member.value)}`;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function printTemplate(template: TemplateLiteral): string {
    let result: string = '`' + template.quasis[0];
    for (let i: number = 0; i < template.expressions.length; i++) {
        result += '${' + printExpression(template.expressions[i]) + '}' + template.quasis[i + 1];
    }
    return result + '`';
}

// eslint-disable-next-line jsdoc/require-jsdoc
function printArrow(arrow: ArrowFunctionExpression): string {
    const asyncPrefix: string = arrow.async ? 'async ' : '';
    const params: string = `(${arrow.params.map(printPattern).join(', ')})`;
    const body: string = arrow.body.kind === 'BlockStatement'
        ? printBlock(arrow.body)
        : printExpression(arrow.body);
    return `${asyncPrefix}${params} => ${body}`;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function printFunctionExpression(fn: FunctionExpression): string {
    const asyncPrefix: string = fn.async ? 'async ' : '';
    const star: string = fn.generator ? '*' : '';
    const name: string = fn.id ?? '';
    return `${asyncPrefix}function${star} ${name}(${fn.params.map(printPattern).join(', ')}) ${printBlock(fn.body)}`;
}

/**
 * Prints a statement node back to JavaScript source.
 * @param statement - The statement to print.
 * @returns The JavaScript source.
 */
export function printStatement(statement: Statement): string {
    switch (statement.kind) {
        case 'VariableDeclaration': {
            return `${printVariableDeclaration(statement)};`;
        }
        case 'FunctionDeclaration': {
            return `${statement.async ? 'async ' : ''}function${statement.generator ? '*' : ''} `
                + `${statement.id}(${statement.params.map(printPattern).join(', ')}) ${printBlock(statement.body)}`;
        }
        case 'BlockStatement': {
            return printBlock(statement);
        }
        case 'ExpressionStatement': {
            return `${printExpression(statement.expression)};`;
        }
        case 'ReturnStatement': {
            return statement.argument ? `return ${printExpression(statement.argument)};` : 'return;';
        }
        case 'IfStatement': {
            return printIf(statement);
        }
        case 'ForStatement': {
            return printFor(statement);
        }
        case 'ForOfStatement': {
            return `for (${printForTarget(statement.left)} of ${printExpression(statement.right)}) ${printStatement(statement.body)}`;
        }
        case 'WhileStatement': {
            return `while (${printExpression(statement.test)}) ${printStatement(statement.body)}`;
        }
        case 'BreakStatement': {
            return statement.label ? `break ${statement.label};` : 'break;';
        }
        case 'ContinueStatement': {
            return statement.label ? `continue ${statement.label};` : 'continue;';
        }
        case 'ThrowStatement': {
            return `throw ${printExpression(statement.argument)};`;
        }
        case 'TryStatement': {
            return printTry(statement);
        }
        case 'SwitchStatement': {
            return printSwitch(statement);
        }
        case 'EmptyStatement': {
            return ';';
        }
        case 'LabeledStatement': {
            return `${statement.label}: ${printStatement(statement.body)}`;
        }
        default: {
            return '';
        }
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
function printBlock(block: BlockStatement): string {
    if (block.body.length === 0) {
        return '{}';
    }
    return `{\n${block.body.map(s => printStatement(s)).join('\n')}\n}`;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function printVariableDeclaration(declaration: VariableDeclaration): string {
    const declarators: string = declaration.declarations
        .map(d => d.init ? `${printPattern(d.id)} = ${printExpression(d.init)}` : printPattern(d.id))
        .join(', ');
    return `${declaration.declarationKind} ${declarators}`;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function printForTarget(target: VariableDeclaration | Pattern): string {
    return target.kind === 'VariableDeclaration' ? printVariableDeclaration(target) : printPattern(target);
}

// eslint-disable-next-line jsdoc/require-jsdoc
function printIf(statement: Extract<Statement, { kind: 'IfStatement' }>): string {
    const base: string = `if (${printExpression(statement.test)}) ${printStatement(statement.consequent)}`;
    return statement.alternate ? `${base} else ${printStatement(statement.alternate)}` : base;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function printFor(statement: Extract<Statement, { kind: 'ForStatement' }>): string {
    const init: string = statement.init
        ? statement.init.kind === 'VariableDeclaration' ? printVariableDeclaration(statement.init) : printExpression(statement.init)
        : '';
    const test: string = statement.test ? printExpression(statement.test) : '';
    const update: string = statement.update ? printExpression(statement.update) : '';
    return `for (${init}; ${test}; ${update}) ${printStatement(statement.body)}`;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function printTry(statement: Extract<Statement, { kind: 'TryStatement' }>): string {
    let result: string = `try ${printBlock(statement.block)}`;
    if (statement.handlerBody) {
        const param: string = statement.handlerParam ? ` (${printPattern(statement.handlerParam)})` : '';
        result += ` catch${param} ${printBlock(statement.handlerBody)}`;
    }
    if (statement.finalizer) {
        result += ` finally ${printBlock(statement.finalizer)}`;
    }
    return result;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function printSwitch(statement: Extract<Statement, { kind: 'SwitchStatement' }>): string {
    const cases: string = statement.cases
        .map(c => {
            const label: string = c.test ? `case ${printExpression(c.test)}:` : 'default:';
            const body: string = c.consequent.map(s => printStatement(s)).join('\n');
            return body ? `${label}\n${body}` : label;
        })
        .join('\n');
    return `switch (${printExpression(statement.discriminant)}) {\n${cases}\n}`;
}

/**
 * Prints a binding pattern back to JavaScript source.
 * @param pattern - The pattern to print.
 * @returns The JavaScript source.
 */
export function printPattern(pattern: Pattern): string {
    switch (pattern.kind) {
        case 'IdentifierPattern': {
            return pattern.name;
        }
        case 'RestElement': {
            return `...${printPattern(pattern.argument)}`;
        }
        case 'ObjectPattern': {
            return printObjectPattern(pattern);
        }
        case 'ArrayPattern': {
            return `[${[
                ...pattern.elements.map(e => e ? printPattern(e) : ''),
                ...pattern.rest ? [`...${printPattern(pattern.rest)}`] : []
            ].join(', ')}]`;
        }
        case 'AssignmentPattern': {
            return `${printPattern(pattern.left)} = ${printExpression(pattern.right)}`;
        }
        default: {
            return '';
        }
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
function printObjectPattern(pattern: ObjectPattern): string {
    const props: string[] = pattern.properties.map(printObjectPatternProperty);
    if (pattern.rest) {
        props.push(`...${pattern.rest}`);
    }
    return `{ ${props.join(', ')} }`;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function printObjectPatternProperty(property: ObjectPatternProperty): string {
    const key: string = property.computed ? `[${property.key}]` : property.key;
    if (property.shorthand) {
        if (property.value.kind === 'AssignmentPattern') {
            return `${key} = ${printExpression(property.value.right)}`;
        }
        return key;
    }
    return `${key}: ${printPattern(property.value)}`;
}

// ---------------------------------------------------------------------------
// JSX lowering
// ---------------------------------------------------------------------------

/**
 * Whether a JSX name refers to a host (native) element rather than a component.
 * @param name - The JSX tag name.
 * @returns True for lowercase single-identifier tags.
 */
function isHostElement(name: JSXName): boolean {
    return name.kind === 'JSXIdentifier' && !!name.name && name.name.startsWith(name.name[0].toLowerCase());
}

// eslint-disable-next-line jsdoc/require-jsdoc
function jsxNameToString(name: JSXName): string {
    return name.kind === 'JSXIdentifier' ? name.name : `${jsxNameToString(name.object)}.${name.property}`;
}

/**
 * Lowers a JSX element to a JavaScript expression that builds its HTML (a {@link SSR}.raw value).
 * @param element - The JSX element.
 * @returns The JavaScript source.
 */
export function lowerJsxElement(element: JSXElement): string {
    return isHostElement(element.name) ? lowerHostElement(element) : lowerComponentElement(element);
}

// eslint-disable-next-line jsdoc/require-jsdoc
function lowerHostElement(element: JSXElement): string {
    const tag: string = jsxNameToString(element.name);
    const attributes: string[] = element.attributes.map(lowerAttribute).filter(a => a.length > 0);
    const handlerStamp: string = stampHandlers(element);
    if (handlerStamp.length > 0) {
        attributes.push(handlerStamp);
    }

    if (VOID_ELEMENTS.has(tag)) {
        // eslint-disable-next-line sonar/no-nested-template-literals
        return `${SSR}.raw(${[quote(`<${tag}`), ...attributes, quote('/>')].join(' + ')})`;
    }

    const innerHtml: string | undefined = dangerousInnerHtml(element.attributes);
    const children: string[] = innerHtml !== undefined
        ? [innerHtml]
        : element.children.map(lowerChild).filter(c => c.length > 0);
    const parts: string[] = [quote(`<${tag}`), ...attributes, quote('>'), ...children, quote(`</${tag}>`)];
    return `${SSR}.raw(${parts.join(' + ')})`;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function lowerComponentElement(element: JSXElement): string {
    const name: string = jsxNameToString(element.name);
    const entries: string[] = [];
    for (const attribute of element.attributes) {
        if (attribute.kind === 'JSXSpreadAttribute') {
            entries.push(`...${printExpression(attribute.argument)}`);
        }
        else {
            entries.push(componentPropEntry(attribute));
        }
    }
    const childrenValue: string | undefined = componentChildrenValue(element.children);
    if (childrenValue !== undefined) {
        entries.push(`children: ${childrenValue}`);
    }
    // Routed through the runtime so it can register a client instance for components that have
    // client behavior, then delegate to their server render.
    return `${SSR}.component(${name}, { ${entries.join(', ')} })`;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function componentPropEntry(attribute: JSXAttribute): string {
    const key: string = /^[$_a-z][\w$]*$/i.test(attribute.name) ? attribute.name : quote(attribute.name);
    if (!attribute.value) {
        return `${key}: true`;
    }
    if (attribute.value.kind === 'StringLiteral') {
        return `${key}: ${attribute.value.raw}`;
    }
    const expr: Expression | undefined = attribute.value.expression;
    if (expr && isEventHandlerName(attribute.name)) {
        return `${key}: ${handlerPropValue(expr)}`;
    }
    const propSite: ClientPropSite | undefined = expr ? clientPropMap?.get(expr) : undefined;
    if (propSite) {
        // The function stays in this component's client setup; the child gets a reference to it.
        return `${key}: ${SSR}.markProp('${propSite.id}', [${propSite.captureVars.join(', ')}])`;
    }
    return `${key}: ${expr ? printExpression(expr) : 'undefined'}`;
}

/**
 * The value for an event-handler prop passed to a nested component: a fresh marker for a new site,
 * or the forwarded expression (already a marker) for a prop pass-through.
 * @param handler - The handler expression.
 * @returns The generated value source.
 */
function handlerPropValue(handler: Expression): string {
    const site: HandlerSite | undefined = handlerStampMap?.get(handler);
    if (site) {
        return `${SSR}.mark('${site.id}', [${site.captureVars.join(', ')}])`;
    }
    return printExpression(handler);
}

// eslint-disable-next-line jsdoc/require-jsdoc
function componentChildrenValue(children: JSXChild[]): string | undefined {
    const values: string[] = children.map(childValue).filter(c => c.length > 0);
    if (values.length === 0) {
        return undefined;
    }
    return values.length === 1 ? values[0] : `[${values.join(', ')}]`;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function childValue(child: JSXChild): string {
    switch (child.kind) {
        case 'JSXText': {
            const text: string = normalizeJsxText(child.value);
            return text ? quote(text) : '';
        }
        case 'JSXElement': {
            return lowerJsxElement(child);
        }
        case 'JSXFragment': {
            return lowerJsxFragment(child);
        }
        case 'JSXExpressionContainer': {
            return child.expression ? printExpression(child.expression) : '';
        }
        default: {
            return '';
        }
    }
}

/**
 * Lowers a JSX fragment to a {@link SSR}.raw value that concatenates its children.
 * @param fragment - The JSX fragment.
 * @returns The JavaScript source.
 */
export function lowerJsxFragment(fragment: JSXFragment): string {
    const children: string[] = fragment.children.map(lowerChild).filter(c => c.length > 0);
    return children.length > 0 ? `${SSR}.raw(${children.join(' + ')})` : `${SSR}.raw('')`;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function lowerChild(child: JSXChild): string {
    switch (child.kind) {
        case 'JSXText': {
            const text: string = normalizeJsxText(child.value);
            return text ? quote(escapeText(text)) : '';
        }
        case 'JSXElement': {
            return `${SSR}.child(${lowerJsxElement(child)})`;
        }
        case 'JSXFragment': {
            return `${SSR}.child(${lowerJsxFragment(child)})`;
        }
        case 'JSXExpressionContainer': {
            return child.expression ? `${SSR}.child(${printExpression(child.expression)})` : '';
        }
        default: {
            return '';
        }
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
function lowerAttribute(attribute: JSXAttribute | JSXSpreadAttribute): string {
    if (attribute.kind === 'JSXSpreadAttribute') {
        return `${SSR}.spread(${printExpression(attribute.argument)})`;
    }
    if (isEventHandlerName(attribute.name) || attribute.name === 'dangerouslySetInnerHTML') {
        return '';
    }
    if (!attribute.value) {
        return quote(` ${mapAttributeName(attribute.name)}`);
    }
    if (attribute.value.kind === 'StringLiteral') {
        return quote(` ${mapAttributeName(attribute.name)}="${escapeAttribute(attribute.value.value)}"`);
    }
    const expr: string = attribute.value.expression ? printExpression(attribute.value.expression) : 'undefined';
    return `${SSR}.attr(${quote(attribute.name)}, ${expr})`;
}

/**
 * Emits the `data-ssr-handlers` stamping attribute for a host element's collected handler sites,
 * or an empty string when the current session has no matching handlers.
 * @param element - The host element.
 * @returns A `$ssr.on([...])` attribute expression, or an empty string.
 */
function stampHandlers(element: JSXElement): string {
    if (!handlerStampMap) {
        return '';
    }
    const specs: string[] = [];
    for (const attribute of element.attributes) {
        if (attribute.kind !== 'JSXAttribute'
            || !isEventHandlerName(attribute.name)
            || !attribute.value
            || attribute.value.kind !== 'JSXExpressionContainer'
            || !attribute.value.expression) {
            continue;
        }
        const handler: Expression = attribute.value.expression;
        const event: string = attribute.name.slice(2).toLowerCase();
        const site: HandlerSite | undefined = handlerStampMap.get(handler);
        specs.push(site
            ? `{ site: '${site.id}', event: '${event}', captured: [${site.captureVars.join(', ')}] }`
            : `{ marker: ${printExpression(handler)}, event: '${event}' }`);
    }
    return specs.length > 0 ? `${SSR}.on([${specs.join(', ')}])` : '';
}

// eslint-disable-next-line jsdoc/require-jsdoc
function dangerousInnerHtml(attributes: (JSXAttribute | JSXSpreadAttribute)[]): string | undefined {
    for (const attribute of attributes) {
        if (attribute.kind === 'JSXAttribute'
            && attribute.name === 'dangerouslySetInnerHTML'
            && attribute.value?.kind === 'JSXExpressionContainer'
            && attribute.value.expression) {
            return `String((${printExpression(attribute.value.expression)}).__html ?? '')`;
        }
    }
    return undefined;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function mapAttributeName(name: string): string {
    if (name === 'className') {
        return 'class';
    }
    if (name === 'htmlFor') {
        return 'for';
    }
    return name;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function isEventHandlerName(name: string): boolean {
    return name.length > 2 && name.startsWith('on') && name[2] === name[2].toUpperCase();
}

// eslint-disable-next-line jsdoc/require-jsdoc
function quote(value: string): string {
    return `'${value.replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')
        .replaceAll('\n', '\\n')
        .replaceAll('\r', '\\r')}'`;
}