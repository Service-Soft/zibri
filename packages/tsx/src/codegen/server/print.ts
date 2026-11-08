import * as ts from 'typescript';

import { decodeJsxEntities, normalizeJsxText } from './jsx-text';
import { AccessShape } from '../../runtime/access-shape';
import { escapeAttribute, escapeText, VOID_ELEMENTS } from '../../runtime/server-runtime';
import { isBindingIdentifier } from '../../semantics/binding';
import { symbolOf } from '../../semantics/symbols';
import { tagNameOf } from '../../semantics/validate-email';
import { isHookCall, unwrapTypeSyntax } from '../../semantics/walk';
import { BindingSite } from '../client/bindings';
import { ClientPropSite } from '../client/client-props';
import { containsJsx, JsxMarkup, PartPropKind, RegionCollection, RegionForm, RegionSite, resolveForm } from '../client/regions';
import { attributeExpression, attributesOf, HandlerSite, isEventHandlerName, JsxElementLike } from '../client/handlers';

/**
 * Name of the injected server-runtime helper namespace referenced by generated code.
 */
export const SSR: string = '$ssr';

/**
 * The hooks the page finds what they create by the name of the variable it is assigned to.
 */
const NAMED_HOOKS: readonly string[] = ['useRef', 'useRefs', 'useState', 'useInput', 'useWritableInput'];

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
    clientProps: Map<ts.Expression, ClientPropSite>,
    /**
     * Binding-site lookup keyed by the expression of the markup that reads state.
     */
    bindings: Map<ts.Expression, BindingSite>,
    /**
     * The props the component forwards as they are to an attribute of an element or into a text, which follow a state
     * when a component above handed one in.
     */
    forwards: ReadonlySet<ts.Expression>,
    /**
     * The conditions and lists that read state, which the browser renders again, by their expression.
     */
    regions: ReadonlyMap<ts.Expression, RegionSite>,
    /**
     * The attributes inside them holding a state itself that binds both ways.
     */
    regionTwoWay: ReadonlySet<ts.Expression>,
    /**
     * What the regions hold that only the server renders: the id of each form, the branches and rows it renders into a
     * template, what their components are handed that the page follows, and their holes of html of the server.
     */
    regionParts: Pick<RegionCollection, 'forms' | 'templated' | 'partProps' | 'opaque'>,
    /**
     * The children the component destructures, read from its props where they are used, so they render there.
     */
    lazyChildren?: LazyChildren
};

/**
 * The children a component destructures from its props. Destructuring reads them, and the runtime renders them when
 * they are read, so the render reads them from the props where the component uses them instead: after what its body
 * does first, such as providing a context to them.
 */
export type LazyChildren = {
    /**
     * The variable the component binds them to.
     */
    symbol: ts.Symbol,
    /**
     * Its default, for children that are not handed.
     */
    fallback: ts.Expression | undefined
};

/**
 * The name of the props parameter of a server render whose children are read lazily.
 */
export const LAZY_PROPS: string = '__props';

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
    return printLowered(node, stamps, false, file);
}

/**
 * Prints a node that goes into the client script, the way {@link printNode} does. Every `onServer` call
 * in it, however deep, loses its callback: that code runs on the server, and the page would carry its
 * text for anyone to read.
 * @param node - The node to print.
 * @param file - The file the node's text comes from, for a node built from parts of it.
 * @returns The source.
 */
export function printClientNode(node: ts.Node, file: ts.SourceFile = node.getSourceFile()): string {
    return printLowered(node, undefined, true, file);
}

/**
 * Lowers a node and prints it.
 * @param node - The node to print.
 * @param stamps - The sites to stamp, if any.
 * @param clientCode - Whether the node goes into the client script.
 * @param file - The file the node's text comes from.
 * @returns The source.
 */
function printLowered(node: ts.Node, stamps: StampSites | undefined, clientCode: boolean, file: ts.SourceFile): string {
    const result: ts.TransformationResult<ts.Node> = ts.transform(
        node,
        [context => root => new JsxLowering(context, stamps, clientCode).visit(root)]
    );
    const printed: string = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
        .printNode(ts.EmitHint.Unspecified, result.transformed[0], file);
    result.dispose();
    return printed;
}

/**
 * The lowering of one print: JSX to runtime calls, inlined hooks to runtime methods, and the two forms
 * the printed code has always spelled out - a shorthand method as the function property it stands
 * for, and a `new` with its argument list.
 */
class JsxLowering {
    private readonly factory: ts.NodeFactory;

    /**
     * Whether the markup being lowered is inside a condition or a list the browser renders again, which marks its
     * texts and stamps none of its handlers.
     */
    private inRegion: boolean = false;

    constructor(
        private readonly context: ts.TransformationContext,
        private readonly stamps: StampSites | undefined,
        private readonly clientCode: boolean
    ) {
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
        const lazy: LazyChildren | undefined = this.stamps?.lazyChildren;
        if (lazy !== undefined && ts.isShorthandPropertyAssignment(node) && symbolOf(node.name) === lazy.symbol) {
            return this.factory.createPropertyAssignment(node.name.text, this.lazyChildrenValue(lazy));
        }
        if (lazy !== undefined && ts.isIdentifier(node) && !isBindingIdentifier(node) && symbolOf(node) === lazy.symbol) {
            return this.lazyChildrenValue(lazy);
        }
        if (this.clientCode && isHookCall(node, 'onServer')) {
            return this.factory.updateCallExpression(node, node.expression, node.typeArguments, []);
        }
        // an effect only ever runs in the page, so nothing of it is left in the module the server runs
        if (!this.clientCode && isHookCall(node, 'useEffect')) {
            return this.factory.createVoidZero();
        }
        if (NAMED_HOOKS.some(hook => isHookCall(node, hook)) && ts.isCallExpression(node)) {
            return this.lowerNamedHook(node);
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
                // a value provided that follows a state is handed down as one
                return this.runtimeCall(inlined, node.arguments.map((argument, index) => inlined === 'provideContext' && index === 1
                    ? this.inputValue(argument)
                    : this.expression(argument)));
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
        return ts.isNewExpression(node) && node.arguments == undefined
            ? this.factory.createNewExpression(this.expression(node.expression), node.typeArguments, [])
            : ts.visitEachChild(node, this.visit, this.context);
    };

    /**
     * Lowers `useRef`, `useRefs`, `useState`, `useInput` and `useWritableInput`. On the server they create the ref or
     * the handle on the render's runtime, named by the variable it is assigned to and its component. In the browser the
     * setup finds it by that name, whichever of them its client code reads, and the argument stays on the server.
     * @param node - The call.
     * @returns `$ssr.useRefs(component, name)`, or `$ssr.<hook>(argument, component, name)`, on the server, the hook
     * called with the name in the browser.
     */
    private lowerNamedHook(node: ts.CallExpression): ts.CallExpression {
        const hook: string = NAMED_HOOKS.find(name => isHookCall(node, name)) ?? '';
        const name: ts.Expression = this.quote(ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name.text : '');
        if (this.clientCode) {
            return this.factory.createCallExpression(this.factory.createIdentifier(hook), undefined, [name]);
        }
        const component: ts.Expression = this.quote(enclosingFunctionName(node));
        if (hook === 'useRefs') {
            return this.runtimeCall(hook, [component, name]);
        }
        const [first] = node.arguments;
        const unwrapped: ts.Expression | undefined = first === undefined ? undefined : unwrapTypeSyntax(first);
        let argument: ts.Expression;
        if (first === undefined || unwrapped === undefined) {
            argument = this.factory.createIdentifier('undefined');
        }
        else if ((hook === 'useInput' || hook === 'useWritableInput') && isHookCall(unwrapped, 'useContext')) {
            // a context read for an input keeps a value following a state as one
            const context: ts.Expression | undefined = unwrapped.arguments[0];
            argument = this.runtimeCall('useContext', [
                context === undefined ? this.factory.createIdentifier('undefined') : this.expression(context),
                this.factory.createTrue()
            ]);
        }
        else {
            argument = this.expression(first);
        }
        return this.runtimeCall(hook, [argument, component, name]);
    }

    /**
     * Where a component uses the children it destructures, read from its props.
     * @param lazy - The children.
     * @returns `__props.children`, or with the default for children that are not handed.
     */
    private lazyChildrenValue(lazy: LazyChildren): ts.Expression {
        const read: () => ts.Expression = () => this.factory.createPropertyAccessExpression(this.factory.createIdentifier(LAZY_PROPS), 'children');
        if (lazy.fallback === undefined) {
            return read();
        }
        return this.factory.createParenthesizedExpression(this.factory.createConditionalExpression(
            this.factory.createStrictEquality(read(), this.factory.createIdentifier('undefined')),
            undefined,
            this.expression(lazy.fallback),
            undefined,
            read()
        ));
    }

    /**
     * The value of a prop of a component, or of a context provided: one following a state when it reads one.
     * @param expression - The value.
     * @returns `$ssr.input(site, captured, value, handle)` for a value following a state, the value otherwise.
     */
    private inputValue(expression: ts.Expression): ts.Expression {
        const site: BindingSite | undefined = this.stamps?.bindings.get(expression);
        return site === undefined || site.kind !== 'prop'
            ? this.expression(expression)
            : this.runtimeCall('input', [
                this.quote(site.id),
                this.capturedValues(site),
                // a state itself is handed as it is, and a value derived from one is left out of a template
                site.handle ? this.expression(expression) : this.read(this.expression(expression)),
                site.handle ? this.factory.createTrue() : this.factory.createFalse()
            ]);
    }

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
            ...shape.items === undefined ? [] : [this.factory.createPropertyAssignment('items', this.shapeLiteral(shape.items))],
            ...shape.restExcept === undefined
                ? []
                : [
                    this.factory.createPropertyAssignment(
                        'restExcept',
                        this.factory.createArrayLiteralExpression(shape.restExcept.map(field => this.quote(field)))
                    )
                ]
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
        // html has no value attribute for these: a textarea holds its value as its text, and a select marks its option
        const valueAttribute: ts.JsxAttribute | undefined = tag === 'textarea' || tag === 'select'
            ? attributesOf(element).find((attribute): attribute is ts.JsxAttribute => ts.isJsxAttribute(attribute)
                && attribute.name.getText() === 'value')
            : undefined;
        const attributes: ts.Expression[] = attributesOf(element)
            .filter(attribute => attribute !== valueAttribute)
            .flatMap(attribute => this.lowerAttribute(attribute));
        const handlerStamp: ts.Expression | undefined = this.stampHandlers(element);
        if (handlerStamp !== undefined) {
            attributes.push(handlerStamp);
        }

        if (VOID_ELEMENTS.has(tag)) {
            return this.runtimeCall('raw', [this.concat([this.quote(`<${tag}`), ...attributes, this.quote('/>')])]);
        }

        const innerHtml: ts.Expression | undefined = this.dangerousInnerHtml(element);
        let children: ts.Expression[] = innerHtml !== undefined
            ? [innerHtml]
            : this.childrenOf(element).flatMap(child => this.lowerChild(child));
        if (valueAttribute !== undefined) {
            const value: ts.Expression = this.attributeValue(valueAttribute);
            children = tag === 'textarea'
                ? [this.runtimeCall('child', [value])]
                : [this.runtimeCall('selectOption', [children.length > 0 ? this.concat(children) : this.quote(''), value])];
        }
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
                continue;
            }
            // the key of a row is read by the list, and the server renders a template without its item
            if (this.inRegion && attribute.name.getText() === 'key') {
                continue;
            }
            const kind: PartPropKind | undefined = this.stamps?.regionParts.partProps.get(attribute);
            entries.push(kind === undefined ? this.componentPropEntry(attribute) : this.partPropEntry(attribute, kind));
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
        // client behavior, then delegate to their server render. Inside markup the browser renders again, it is a part
        // of that markup the page takes over, and copies from a template.
        return this.runtimeCall(this.inRegion ? 'part' : 'component', args);
    }

    /**
     * The entry of a prop the page follows, of a component inside markup the browser renders again: computed in a
     * function, which the server calls where it renders the value and not for a template.
     * @param attribute - The attribute.
     * @param kind - How the page follows it.
     * @returns `name: $ssr.partFunction(() => value)`, or `name: $ssr.partValue(() => value, isState)`.
     */
    private partPropEntry(attribute: ts.JsxAttribute, kind: PartPropKind): ts.PropertyAssignment {
        const name: string = attribute.name.getText();
        const key: ts.PropertyName = /^[$_a-z][\w$]*$/i.test(name) ? this.factory.createIdentifier(name) : this.quote(name);
        const expression: ts.Expression | undefined = attributeExpression(attribute);
        const value: ts.Expression = this.thunk(expression === undefined ? this.factory.createTrue() : this.expression(expression));
        return this.factory.createPropertyAssignment(key, kind === 'function'
            ? this.runtimeCall('partFunction', [value])
            : this.runtimeCall('partValue', [value, kind === 'state' ? this.factory.createTrue() : this.factory.createFalse()]));
    }

    /**
     * A function computing a value, which the server leaves uncalled where it renders a template.
     * @param value - The lowered value.
     * @returns `() => (value)`.
     */
    private thunk(value: ts.Expression): ts.ArrowFunction {
        return this.factory.createArrowFunction(undefined, undefined, [], undefined, undefined, this.factory.createParenthesizedExpression(value));
    }

    /**
     * A value reading a state or a row, which the server renders where it renders it, and leaves out of a template.
     * @param value - The lowered value.
     * @returns `$ssr.read(() => (value))`.
     */
    private read(value: ts.Expression): ts.Expression {
        return this.runtimeCall('read', [this.thunk(value)]);
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
            return this.factory.createPropertyAssignment(key, this.quote(decodeJsxEntities(initializer.text)));
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
            expression === undefined ? this.factory.createIdentifier('undefined') : this.inputValue(expression)
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
        return site !== undefined ? this.runtimeCall('mark', [this.quote(site.id), this.capturedValues(site)]) : this.expression(handler);
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
            const text: string = decodeJsxEntities(normalizeJsxText(child.text));
            return text ? [this.quote(text)] : [];
        }
        if (ts.isJsxExpression(child)) {
            if (child.expression == undefined) {
                return [];
            }
            return [this.regionPart(child.expression) ?? this.textHole(child.expression, false)];
        }
        return [ts.isJsxFragment(child) ? this.lowerFragment(child) : this.lowerElement(child)];
    }

    /**
     * The part a hole contributes when it is, or is inside, a condition or a list the browser renders again.
     * @param expression - The expression of the hole.
     * @returns `$ssr.region(...)` for one, `$ssr.range(...)` or `$ssr.hole(...)` inside one, or undefined for any
     * other hole.
     */
    private regionPart(expression: ts.Expression): ts.Expression | undefined {
        const site: RegionSite | undefined = this.stamps?.regions.get(expression);
        if (site !== undefined) {
            return this.runtimeCall('region', [this.quote(site.id), this.capturedValues(site), this.regionForm(expression, site.form)]);
        }
        if (!this.inRegion) {
            return undefined;
        }
        // html of the server, which the page takes over as it is
        if (this.stamps?.regionParts.opaque.has(expression) === true) {
            // the markup in it reads nothing the browser writes, so it is printed as it is outside a region, and the
            // template holds its values as the page does
            this.inRegion = false;
            try {
                return this.runtimeCall('opaque', [this.expression(expression)]);
            }
            finally {
                this.inRegion = true;
            }
        }
        // checked when the regions were collected, so markup in it is one of the forms
        const nested: RegionForm | undefined = containsJsx(expression) ? resolveForm(expression, { diagnostics: [] }) : undefined;
        return nested === undefined
            ? this.runtimeCall('hole', [this.read(this.expression(expression))])
            : this.runtimeCall('range', [this.regionForm(expression, nested)]);
    }

    /**
     * A condition or a list the browser renders again, for the runtime: its id, and functions rendering what holds, and
     * each branch or the row a template is rendered of.
     * @param expression - The expression of the form.
     * @param form - The form.
     * @returns `$ssr.when(id, condition, whenTrue, whenFalse, templated)` or `$ssr.rows(id, items, row, key, templated)`.
     */
    private regionForm(expression: ts.Expression, form: RegionForm): ts.Expression {
        const outer: boolean = this.inRegion;
        this.inRegion = true;
        try {
            const id: ts.Expression = this.quote(this.stamps?.regionParts.forms.get(expression) ?? '');
            const templated: (node: JsxMarkup | undefined) => ts.Expression = node => node !== undefined
                && this.stamps?.regionParts.templated.has(node) === true
                ? this.factory.createTrue()
                : this.factory.createFalse();
            const markup: (node: JsxMarkup) => ts.Expression = node => ts.isJsxFragment(node) ? this.lowerFragment(node) : this.lowerElement(node);
            if (form.kind === 'if') {
                const branch: (node: JsxMarkup | undefined) => ts.Expression = node => node === undefined
                    ? this.factory.createIdentifier('undefined')
                    : this.thunk(markup(node));
                return this.runtimeCall('when', [
                    id,
                    this.thunk(this.expression(form.condition)),
                    branch(form.whenTrue),
                    branch(form.whenFalse),
                    templated(form.whenTrue),
                    templated(form.whenFalse)
                ]);
            }
            const parameters: ts.ParameterDeclaration[] = form.callback.parameters.map(parameter => this.visitNode(parameter, ts.isParameter));
            const arrow: (body: ts.Expression) => ts.ArrowFunction = body => this.factory
                .createArrowFunction(undefined, undefined, parameters, undefined, undefined, body);
            return this.runtimeCall('rows', [
                id,
                this.thunk(this.expression(form.list)),
                arrow(markup(form.row)),
                arrow(this.expression(form.key)),
                templated(form.row)
            ]);
        }
        finally {
            this.inRegion = outer;
        }
    }

    /**
     * A text hole: its value, rendered between the comments the browser finds it by when it reads state.
     * @param expression - The expression of the hole.
     * @param rendered - Whether the value is rendered here, as a child of an element of the page, rather than handed
     * to a component as one of its children.
     * @returns `$ssr.text(site, captured, value)` for a binding, `$ssr.child(value)` or the value otherwise.
     */
    private textHole(expression: ts.Expression, rendered: boolean): ts.Expression {
        const site: BindingSite | undefined = this.stamps?.bindings.get(expression);
        let value: ts.Expression = this.expression(expression);
        if (site !== undefined && site.kind === 'text') {
            value = this.runtimeCall('text', [this.quote(site.id), this.capturedValues(site), this.read(value)]);
        }
        // the text of a title or a textarea a binding writes whole
        else if (site !== undefined) {
            value = this.read(value);
        }
        // a prop forwarded into the text, which follows a state when a component above handed one in
        else if (this.stamps?.forwards.has(expression) === true) {
            value = this.runtimeCall('forward', [value]);
        }
        return rendered ? this.runtimeCall('child', [value]) : value;
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
            const text: string = decodeJsxEntities(normalizeJsxText(child.text));
            return text ? [this.quote(escapeText(text))] : [];
        }
        if (ts.isJsxExpression(child)) {
            if (child.expression == undefined) {
                return [];
            }
            const region: ts.Expression | undefined = this.regionPart(child.expression);
            return [region === undefined ? this.textHole(child.expression, true) : this.runtimeCall('child', [region])];
        }
        return [this.runtimeCall('child', [ts.isJsxFragment(child) ? this.lowerFragment(child) : this.lowerElement(child)])];
    }

    /**
     * The HTML part one attribute of a host element contributes.
     * @param attribute - The attribute.
     * @returns The part, or nothing for an event handler and `dangerouslySetInnerHTML`.
     */
    private lowerAttribute(attribute: ts.JsxAttributeLike): ts.Expression[] {
        if (ts.isJsxSpreadAttribute(attribute)) {
            const spread: ts.Expression = this.expression(attribute.expression);
            return [this.runtimeCall('spread', [this.inRegion || this.stamps?.bindings.has(attribute.expression) === true ? this.read(spread) : spread])];
        }
        const name: string = attribute.name.getText();
        // a ref is stamped, with the handlers
        if (isEventHandlerName(name) || name === 'dangerouslySetInnerHTML' || name === 'ref') {
            return [];
        }
        const initializer: ts.JsxAttributeValue | undefined = attribute.initializer;
        if (initializer == undefined) {
            return [this.quote(` ${mapAttributeName(name)}`)];
        }
        if (ts.isStringLiteral(initializer)) {
            return [this.quote(` ${mapAttributeName(name)}="${escapeAttribute(decodeJsxEntities(initializer.text))}"`)];
        }
        return [this.runtimeCall('attr', [this.quote(name), this.attributeValue(attribute)])];
    }

    /**
     * The value an attribute of a host element is written with.
     * @param attribute - The attribute.
     * @returns The value: `true` for one written without one, the text of a string, or the expression.
     */
    private attributeValue(attribute: ts.JsxAttribute): ts.Expression {
        const initializer: ts.JsxAttributeValue | undefined = attribute.initializer;
        if (initializer == undefined) {
            return this.factory.createTrue();
        }
        if (ts.isStringLiteral(initializer)) {
            return this.quote(decodeJsxEntities(initializer.text));
        }
        const expression: ts.Expression | undefined = attributeExpression(attribute);
        const value: ts.Expression = expression === undefined ? this.factory.createIdentifier('undefined') : this.expression(expression);
        // a state itself on a control is written as its value, which it binds both ways
        const twoWay: boolean = expression !== undefined
            && (this.stamps?.bindings.get(expression)?.handle === true || this.stamps?.regionTwoWay.has(expression) === true);
        const written: ts.Expression = twoWay
            ? this.factory.createPropertyAccessExpression(this.factory.createParenthesizedExpression(value), 'value')
            : value;
        // what the browser writes again is left out of a template, and written into the copy
        const followed: boolean = expression !== undefined && (this.inRegion || this.stamps?.bindings.has(expression) === true);
        return followed ? this.read(written) : written;
    }

    /**
     * The `data-ssr` stamping attribute for a host element's handlers and its ref, when a server render is
     * being printed and the element has any.
     * @param element - The host element.
     * @returns A `$ssr.on([...], ref)` attribute expression, or undefined.
     */
    private stampHandlers(element: JsxElementLike): ts.Expression | undefined {
        if (this.stamps === undefined) {
            return undefined;
        }
        const specs: ts.Expression[] = [];
        let ref: ts.Expression | undefined;
        for (const attribute of attributesOf(element)) {
            if (ts.isJsxAttribute(attribute) && attribute.name.getText() === 'ref') {
                const value: ts.Expression | undefined = attributeExpression(attribute);
                ref = value === undefined ? undefined : this.expression(value);
                continue;
            }
            // markup the browser renders again attaches its handlers itself, and only its ref is stamped
            if (this.inRegion) {
                continue;
            }
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
        // the bindings that write to this element: its attributes, and the whole text of a title or a textarea
        const holes: ts.Expression[] = ts.isJsxElement(element)
            ? element.children.flatMap(child => ts.isJsxExpression(child) && child.expression != undefined ? [child.expression] : [])
            : [];
        const bindings: ts.Expression[] = [
            ...attributesOf(element).flatMap(attribute => ts.isJsxAttribute(attribute) ? [attributeExpression(attribute)] : []),
            ...holes
        ].flatMap(expression => {
            const site: BindingSite | undefined = expression === undefined ? undefined : this.stamps?.bindings.get(expression);
            // every hole of a title or a textarea leads to the one binding writing its whole text
            const isFirst: boolean = site !== undefined && site.expression === expression;
            return site === undefined || site.kind === 'text' || !isFirst
                ? []
                : [this.factory.createObjectLiteralExpression([
                    this.factory.createPropertyAssignment('site', this.quote(site.id)),
                    this.factory.createPropertyAssignment('captured', this.capturedValues(site))
                ])];
        });
        // the props forwarded to its attributes, which follow a state when a component above handed one in
        const forwards: ts.Expression[] = attributesOf(element).flatMap(attribute => {
            const expression: ts.Expression | undefined = ts.isJsxAttribute(attribute) ? attributeExpression(attribute) : undefined;
            return ts.isJsxAttribute(attribute) && expression !== undefined && this.stamps?.forwards.has(expression) === true
                ? [this.factory.createArrayLiteralExpression([this.quote(attribute.name.getText()), this.expression(expression)])]
                : [];
        });
        if (specs.length === 0 && ref === undefined && bindings.length === 0 && forwards.length === 0) {
            return undefined;
        }
        return this.runtimeCall('on', [
            this.factory.createArrayLiteralExpression(specs),
            ref ?? this.factory.createIdentifier('undefined'),
            this.factory.createArrayLiteralExpression(bindings),
            ...forwards.length === 0 ? [] : [this.factory.createArrayLiteralExpression(forwards)]
        ]);
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
    return name === 'htmlFor' ? 'for' : name;
}

/**
 * The name of the function a node is in, as it is declared or assigned: the component, for a hook called at
 * the top of one.
 * @param node - The node.
 * @returns The name, or an empty string for a function without one.
 */
function enclosingFunctionName(node: ts.Node): string {
    for (let current: ts.Node | undefined = node.parent; current != undefined; current = current.parent) {
        if (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isArrowFunction(current)) {
            if (current.name != undefined) {
                return current.name.text;
            }
            return ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name) ? current.parent.name.text : '';
        }
    }
    return '';
}