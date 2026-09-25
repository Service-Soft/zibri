import * as ts from 'typescript';

import { normalizeJsxText } from './jsx-text';
import { AccessShape } from '../../runtime/access-shape';
import { escapeAttribute, escapeText, VOID_ELEMENTS } from '../../runtime/server-runtime';
import { tagNameOf } from '../../semantics/validate-email';
import { unwrapTypeSyntax } from '../../semantics/walk';
import { ClientPropSite } from '../client/client-props';
import { attributeExpression, attributesOf, HandlerSite, isEventHandlerName, JsxElementLike } from '../client/handlers';

/**
 * Name of the injected server-runtime helper namespace referenced by generated code.
 */
export const SSR: string = '$ssr';

/**
 * Framework hooks whose calls are lowered to a method on the per-render {@link SSR} runtime instead
 * of being resolved as imports, keyed by hook name to the runtime method it becomes. They need the
 * render runtime, which only exists as the render function's parameter, so they cannot be plain
 * imported functions.
 */
export const SERVER_INLINED_HOOKS: Readonly<Record<string, string>> = {
    provideContext: 'provideContext',
    useContext: 'useContext',
    $raw: 'raw'
};

/**
 * The sites a server render stamps: host elements get their handler sites, and function props on
 * component elements are replaced with a reference to the site that builds them on the client.
 */
export type StampSites = {
    /**
     * Handler-site lookup keyed by handler expression node.
     */
    handlers: Map<ts.Expression, HandlerSite>,
    /**
     * Client-prop site lookup keyed by prop value expression node.
     */
    clientProps: Map<ts.Expression, ClientPropSite>
};

/**
 * Prints a node back to TypeScript source, lowering any embedded JSX to HTML-string-building calls
 * against the {@link SSR} runtime and the server-inlined hooks to their runtime methods.
 *
 * Type syntax is printed as written; it is erased when the assembled code is transpiled. Comments are
 * never printed, because the printed code can end up in the page.
 * @param node - The node to print.
 * @param stamps - The sites to stamp, when printing a server render.
 * @param file - The file the node's text comes from, for a node built from parts of it.
 * @returns The source.
 */
export function printNode(node: ts.Node, stamps?: StampSites, file: ts.SourceFile = node.getSourceFile()): string {
    const result: ts.TransformationResult<ts.Node> = ts.transform(node, [context => root => lowerNode(root, context, stamps)]);
    const printed: string = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
        .printNode(ts.EmitHint.Unspecified, result.transformed[0], file);
    result.dispose();
    return printed;
}

/**
 * Lowers one node and everything below it.
 * @param node - The node.
 * @param context - The transformation context.
 * @param stamps - The sites to stamp, if any.
 * @returns The lowered node.
 */
function lowerNode(node: ts.Node, context: ts.TransformationContext, stamps: StampSites | undefined): ts.Node {
    return new JsxLowering(context, stamps).visit(node);
}

/**
 * The lowering of one print: JSX to runtime calls, inlined hooks to runtime methods, and the two forms
 * the printed code has always spelled out - a shorthand method as the function property it stands
 * for, and a `new` with its argument list.
 */
class JsxLowering {
    private readonly factory: ts.NodeFactory;

    constructor(private readonly context: ts.TransformationContext, private readonly stamps: StampSites | undefined) {
        this.factory = context.factory;
    }

    /**
     * Lowers a node and everything below it.
     * @param node - The node.
     * @returns The lowered node.
     */
    readonly visit: (node: ts.Node) => ts.Node = (node: ts.Node): ts.Node => {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
            return this.lowerElement(node);
        }
        if (ts.isJsxFragment(node)) {
            return this.lowerFragment(node);
        }
        if (ts.isCallExpression(node)) {
            const callee: ts.Expression = unwrapTypeSyntax(node.expression);
            const inlined: string | undefined = ts.isIdentifier(callee) && Object.hasOwn(SERVER_INLINED_HOOKS, callee.text)
                ? SERVER_INLINED_HOOKS[callee.text]
                : undefined;
            // A context hook is a call on the per-render runtime, so it is lowered to a `$ssr` method
            // rather than resolved as an import. That also keeps it server-only: client code that
            // named it would find no import and fail the leak check.
            if (inlined !== undefined && node.questionDotToken == undefined) {
                return this.runtimeCall(inlined, node.arguments.map(this.expression));
            }
        }
        if (ts.isMethodDeclaration(node) && ts.isObjectLiteralExpression(node.parent) && node.body != undefined) {
            return this.factory.createPropertyAssignment(
                this.visitNode(node.name, ts.isPropertyName),
                this.factory.createFunctionExpression(
                    ts.getModifiers(node)?.filter(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword),
                    undefined,
                    undefined,
                    undefined,
                    node.parameters.map(parameter => this.visitNode(parameter, ts.isParameter)),
                    undefined,
                    this.visitNode(node.body, ts.isBlock)
                )
            );
        }
        if (ts.isNewExpression(node) && node.arguments == undefined) {
            return this.factory.createNewExpression(this.expression(node.expression), node.typeArguments, []);
        }
        return ts.visitEachChild(node, this.visit, this.context);
    };

    /**
     * Lowers an expression.
     * @param node - The expression.
     * @returns The lowered expression.
     */
    private readonly expression: (node: ts.Expression) => ts.Expression = (node: ts.Expression): ts.Expression => {
        return this.visitNode(node, ts.isExpression);
    };

    /**
     * Lowers a node that has to stay a node of the given kind.
     * @param node - The node.
     * @param test - The kind it has to stay.
     * @returns The lowered node.
     */
    private visitNode<T extends ts.Node>(node: T, test: (node: ts.Node) => node is T): T {
        return ts.visitNode(node, this.visit, test);
    }

    /**
     * A call of a runtime method: `$ssr.<method>(...args)`.
     * @param method - The runtime method.
     * @param args - The arguments.
     * @returns The call.
     */
    private runtimeCall(method: string, args: ts.Expression[]): ts.CallExpression {
        return this.factory.createCallExpression(
            this.factory.createPropertyAccessExpression(this.factory.createIdentifier(SSR), method),
            undefined,
            args
        );
    }

    /**
     * A single-quoted string literal.
     * @param value - The string value.
     * @returns The literal.
     */
    private quote(value: string): ts.StringLiteral {
        return this.factory.createStringLiteral(value, true);
    }

    /**
     * Joins parts with `+`, left to right.
     * @param parts - The parts, at least one.
     * @returns The concatenation.
     */
    private concat(parts: ts.Expression[]): ts.Expression {
        return parts.slice(1).reduce<ts.Expression>(
            (left, right) => this.factory.createBinaryExpression(left, ts.SyntaxKind.PlusToken, right),
            parts[0]
        );
    }

    /**
     * The values a site captures, each narrowed at render time to what the site reads from it.
     * @param site - The handler or function-prop site.
     * @returns The array literal of captured values.
     */
    private capturedValues(site: Pick<HandlerSite, 'captureVars' | 'captureShapes'>): ts.ArrayLiteralExpression {
        return this.factory.createArrayLiteralExpression(site.captureVars.map((name, index) => {
            const value: ts.Identifier = this.factory.createIdentifier(name);
            const shape: AccessShape = site.captureShapes[index] ?? 'whole';
            return shape === 'whole' ? value : this.runtimeCall('project', [value, this.shapeLiteral(shape)]);
        }));
    }

    /**
     * An access shape as a literal.
     * @param shape - The shape.
     * @returns The literal expression.
     */
    private shapeLiteral(shape: AccessShape): ts.Expression {
        if (shape === 'whole') {
            return this.quote('whole');
        }
        const fields: ts.ObjectLiteralExpression = this.factory.createObjectLiteralExpression(Object.entries(shape.fields)
            .map(([field, fieldShape]) => this.factory.createPropertyAssignment(this.quote(field), this.shapeLiteral(fieldShape))));
        return this.factory.createObjectLiteralExpression([
            this.factory.createPropertyAssignment('fields', fields),
            ...shape.items === undefined ? [] : [this.factory.createPropertyAssignment('items', this.shapeLiteral(shape.items))]
        ]);
    }

    /**
     * Whether a JSX name refers to a host (native) element rather than a component.
     * @param name - The JSX tag name.
     * @returns True for lowercase single-identifier tags.
     */
    private isHostElement(name: ts.Node): boolean {
        if (ts.isPropertyAccessExpression(name)) {
            return false;
        }
        const written: string = ts.isIdentifier(name) ? name.text : name.getText();
        return !!written && written.startsWith(written[0].toLowerCase());
    }

    /**
     * The name a tag was written with.
     * @param name - The JSX tag name, or a part of a member name.
     * @returns The name, dotted for a member name.
     */
    private tagText(name: ts.Node): string {
        if (ts.isPropertyAccessExpression(name)) {
            return `${this.tagText(name.expression)}.${name.name.getText()}`;
        }
        return ts.isIdentifier(name) ? name.text : name.getText();
    }

    /**
     * Lowers a JSX element to an expression that builds its HTML (a {@link SSR}.raw value).
     * @param element - The JSX element.
     * @returns The lowered expression.
     */
    private lowerElement(element: JsxElementLike): ts.Expression {
        return this.isHostElement(tagNameOf(element)) ? this.lowerHostElement(element) : this.lowerComponentElement(element);
    }

    /**
     * Lowers a host element.
     * @param element - The element.
     * @returns The lowered expression.
     */
    private lowerHostElement(element: JsxElementLike): ts.Expression {
        const tag: string = this.tagText(tagNameOf(element));
        const attributes: ts.Expression[] = attributesOf(element).flatMap(attribute => this.lowerAttribute(attribute));
        const handlerStamp: ts.Expression | undefined = this.stampHandlers(element);
        if (handlerStamp !== undefined) {
            attributes.push(handlerStamp);
        }

        if (VOID_ELEMENTS.has(tag)) {
            return this.runtimeCall('raw', [this.concat([this.quote(`<${tag}`), ...attributes, this.quote('/>')])]);
        }

        const innerHtml: ts.Expression | undefined = this.dangerousInnerHtml(element);
        const children: ts.Expression[] = innerHtml !== undefined
            ? [innerHtml]
            : this.childrenOf(element).flatMap(child => this.lowerChild(child));
        const parts: ts.Expression[] = [this.quote(`<${tag}`), ...attributes, this.quote('>'), ...children, this.quote(`</${tag}>`)];
        return this.runtimeCall('raw', [this.concat(parts)]);
    }

    /**
     * The children of a JSX element.
     * @param element - The element.
     * @returns Its children.
     */
    private childrenOf(element: JsxElementLike): readonly ts.JsxChild[] {
        return ts.isJsxElement(element) ? element.children : [];
    }

    /**
     * Lowers a component element to a `$ssr.component` call.
     * @param element - The element.
     * @returns The lowered expression.
     */
    private lowerComponentElement(element: JsxElementLike): ts.Expression {
        const entries: ts.ObjectLiteralElementLike[] = [];
        for (const attribute of attributesOf(element)) {
            if (ts.isJsxSpreadAttribute(attribute)) {
                entries.push(this.factory.createSpreadAssignment(this.expression(attribute.expression)));
            }
            else {
                entries.push(this.componentPropEntry(attribute));
            }
        }
        const children: readonly ts.JsxChild[] = this.childrenOf(element);
        const childrenValue: ts.Expression | undefined = this.childrenValue(children);
        // Children are passed as a thunk so they render when the component reads them, not before it
        // runs. That is what lets a component establish state its children depend on.
        //
        // Static text is the exception: it cannot depend on anything, so it stays an ordinary prop and
        // remains serializable for a client setup that reads it.
        const isStaticText: boolean = children.every(child => ts.isJsxText(child));
        const args: ts.Expression[] = [this.componentReference(tagNameOf(element))];
        if (childrenValue !== undefined && isStaticText) {
            entries.push(this.factory.createPropertyAssignment('children', childrenValue));
        }
        args.push(this.factory.createObjectLiteralExpression(entries));
        if (childrenValue !== undefined && !isStaticText) {
            args.push(this.factory.createArrowFunction(
                undefined,
                undefined,
                [],
                undefined,
                undefined,
                this.factory.createParenthesizedExpression(childrenValue)
            ));
        }
        // Routed through the runtime so it can register a client instance for components that have
        // client behavior, then delegate to their server render.
        return this.runtimeCall('component', args);
    }

    /**
     * The expression a component tag refers to.
     * @param name - The JSX tag name, or a part of a member name.
     * @returns The identifier or member access.
     */
    private componentReference(name: ts.Node): ts.Expression {
        if (ts.isPropertyAccessExpression(name)) {
            return this.factory.createPropertyAccessExpression(this.componentReference(name.expression), name.name.getText());
        }
        return this.factory.createIdentifier(ts.isIdentifier(name) ? name.text : name.getText());
    }

    /**
     * The object entry for one attribute of a component element.
     * @param attribute - The attribute.
     * @returns The entry.
     */
    private componentPropEntry(attribute: ts.JsxAttribute): ts.PropertyAssignment {
        const name: string = attribute.name.getText();
        const key: ts.PropertyName = /^[$_a-z][\w$]*$/i.test(name) ? this.factory.createIdentifier(name) : this.quote(name);
        const initializer: ts.JsxAttributeValue | undefined = attribute.initializer;
        if (initializer == undefined) {
            return this.factory.createPropertyAssignment(key, this.factory.createTrue());
        }
        if (ts.isStringLiteral(initializer)) {
            return this.factory.createPropertyAssignment(key, initializer);
        }
        const expression: ts.Expression | undefined = attributeExpression(attribute);
        if (expression !== undefined && isEventHandlerName(name)) {
            return this.factory.createPropertyAssignment(key, this.handlerPropValue(expression));
        }
        const propSite: ClientPropSite | undefined = expression === undefined ? undefined : this.stamps?.clientProps.get(expression);
        if (propSite !== undefined) {
            // The function stays in this component's client setup; the child gets a reference to it.
            return this.factory.createPropertyAssignment(
                key,
                this.runtimeCall('markProp', [this.quote(propSite.id), this.capturedValues(propSite)])
            );
        }
        return this.factory.createPropertyAssignment(
            key,
            expression === undefined ? this.factory.createIdentifier('undefined') : this.expression(expression)
        );
    }

    /**
     * The value for an event-handler prop passed to a nested component: a fresh marker for a new site,
     * or the forwarded expression (already a marker) for a prop pass-through.
     * @param handler - The handler expression.
     * @returns The value.
     */
    private handlerPropValue(handler: ts.Expression): ts.Expression {
        const site: HandlerSite | undefined = this.stamps?.handlers.get(handler);
        if (site !== undefined) {
            return this.runtimeCall('mark', [this.quote(site.id), this.capturedValues(site)]);
        }
        return this.expression(handler);
    }

    /**
     * The `children` value of a component element: its single child, or an array of them.
     * @param children - The element's children.
     * @returns The value, or undefined when there are none.
     */
    private childrenValue(children: readonly ts.JsxChild[]): ts.Expression | undefined {
        const values: ts.Expression[] = children.flatMap(child => this.childValue(child));
        if (values.length === 0) {
            return undefined;
        }
        return values.length === 1 ? values[0] : this.factory.createArrayLiteralExpression(values);
    }

    /**
     * The value one child contributes to a component's `children`.
     * @param child - The child.
     * @returns The value, or nothing for whitespace and an empty container.
     */
    private childValue(child: ts.JsxChild): ts.Expression[] {
        if (ts.isJsxText(child)) {
            const text: string = normalizeJsxText(child.text);
            return text ? [this.quote(text)] : [];
        }
        if (ts.isJsxExpression(child)) {
            return child.expression == undefined ? [] : [this.expression(child.expression)];
        }
        if (ts.isJsxFragment(child)) {
            return [this.lowerFragment(child)];
        }
        return [this.lowerElement(child)];
    }

    /**
     * Lowers a JSX fragment to a {@link SSR}.raw value that concatenates its children.
     * @param fragment - The JSX fragment.
     * @returns The lowered expression.
     */
    private lowerFragment(fragment: ts.JsxFragment): ts.Expression {
        const children: ts.Expression[] = fragment.children.flatMap(child => this.lowerChild(child));
        return this.runtimeCall('raw', [children.length > 0 ? this.concat(children) : this.quote('')]);
    }

    /**
     * The HTML part one child of a host element or fragment contributes.
     * @param child - The child.
     * @returns The part, or nothing for whitespace and an empty container.
     */
    private lowerChild(child: ts.JsxChild): ts.Expression[] {
        if (ts.isJsxText(child)) {
            const text: string = normalizeJsxText(child.text);
            return text ? [this.quote(escapeText(text))] : [];
        }
        if (ts.isJsxExpression(child)) {
            return child.expression == undefined ? [] : [this.runtimeCall('child', [this.expression(child.expression)])];
        }
        if (ts.isJsxFragment(child)) {
            return [this.runtimeCall('child', [this.lowerFragment(child)])];
        }
        return [this.runtimeCall('child', [this.lowerElement(child)])];
    }

    /**
     * The HTML part one attribute of a host element contributes.
     * @param attribute - The attribute.
     * @returns The part, or nothing for an event handler and `dangerouslySetInnerHTML`.
     */
    private lowerAttribute(attribute: ts.JsxAttributeLike): ts.Expression[] {
        if (ts.isJsxSpreadAttribute(attribute)) {
            return [this.runtimeCall('spread', [this.expression(attribute.expression)])];
        }
        const name: string = attribute.name.getText();
        if (isEventHandlerName(name) || name === 'dangerouslySetInnerHTML') {
            return [];
        }
        const initializer: ts.JsxAttributeValue | undefined = attribute.initializer;
        if (initializer == undefined) {
            return [this.quote(` ${mapAttributeName(name)}`)];
        }
        if (ts.isStringLiteral(initializer)) {
            return [this.quote(` ${mapAttributeName(name)}="${escapeAttribute(initializer.text)}"`)];
        }
        const expression: ts.Expression | undefined = attributeExpression(attribute);
        return [
            this.runtimeCall('attr', [
                this.quote(name),
                expression === undefined ? this.factory.createIdentifier('undefined') : this.expression(expression)
            ])
        ];
    }

    /**
     * The `data-ssr-handlers` stamping attribute for a host element's handlers, when a server render is
     * being printed and the element has any.
     * @param element - The host element.
     * @returns A `$ssr.on([...])` attribute expression, or undefined.
     */
    private stampHandlers(element: JsxElementLike): ts.Expression | undefined {
        if (this.stamps === undefined) {
            return undefined;
        }
        const specs: ts.Expression[] = [];
        for (const attribute of attributesOf(element)) {
            if (!ts.isJsxAttribute(attribute) || !isEventHandlerName(attribute.name.getText())) {
                continue;
            }
            const handler: ts.Expression | undefined = attributeExpression(attribute);
            if (handler === undefined) {
                continue;
            }
            const event: string = attribute.name.getText().slice(2)
                .toLowerCase();
            const site: HandlerSite | undefined = this.stamps.handlers.get(handler);
            specs.push(site === undefined
                ? this.factory.createObjectLiteralExpression([
                    this.factory.createPropertyAssignment('marker', this.expression(handler)),
                    this.factory.createPropertyAssignment('event', this.quote(event))
                ])
                : this.factory.createObjectLiteralExpression([
                    this.factory.createPropertyAssignment('site', this.quote(site.id)),
                    this.factory.createPropertyAssignment('event', this.quote(event)),
                    this.factory.createPropertyAssignment('captured', this.capturedValues(site))
                ]));
        }
        return specs.length > 0 ? this.runtimeCall('on', [this.factory.createArrayLiteralExpression(specs)]) : undefined;
    }

    /**
     * The inner HTML a `dangerouslySetInnerHTML` attribute sets, as the only child of its element.
     * @param element - The host element.
     * @returns `String((value).__html ?? '')`, or undefined when the attribute is absent.
     */
    private dangerousInnerHtml(element: JsxElementLike): ts.Expression | undefined {
        for (const attribute of attributesOf(element)) {
            if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== 'dangerouslySetInnerHTML') {
                continue;
            }
            const expression: ts.Expression | undefined = attributeExpression(attribute);
            if (expression === undefined) {
                continue;
            }
            const html: ts.Expression = this.factory.createPropertyAccessExpression(
                this.factory.createParenthesizedExpression(this.expression(expression)),
                '__html'
            );
            const htmlOrEmpty: ts.Expression = this.factory
                .createBinaryExpression(html, ts.SyntaxKind.QuestionQuestionToken, this.quote(''));
            return this.factory.createCallExpression(this.factory.createIdentifier('String'), undefined, [htmlOrEmpty]);
        }
        return undefined;
    }
}

/**
 * Maps a JSX attribute name to its HTML name.
 * @param name - The JSX attribute name.
 * @returns The HTML attribute name.
 */
function mapAttributeName(name: string): string {
    if (name === 'className') {
        return 'class';
    }
    if (name === 'htmlFor') {
        return 'for';
    }
    return name;
}