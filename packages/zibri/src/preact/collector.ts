import { ComponentChild, ComponentChildren, Fragment, VNode } from 'preact';

import { stringAwareReplace } from './string-aware-replace.function';
import { InternalError } from '../error-handling/internal-error.model';
import { JsonUtilities } from '../utilities/json.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';

const HANDLERS_DIRECTIVE: string = 'data-ssr-handlers';

/**
 * Context of a current loop iteration.
 */
type LoopContext = {
    /**
     * The name of the currently looped over value.
     */
    varName: string,
    /**
     * The currently looped over value.
     */
    value: unknown
};

/**
 * A registered event handler entry.
 */
type HandlerEntry = {
    /**
     * The event, e.g. 'click'.
     */
    event: string,
    /**
     * Either a bare identifier ('increaseCount') or a full function expression.
     * May be renamed by PreactUtilities after the walk via applyRenames().
     */
    src: string,
    /**
     * The prefix of the component instance whose rendered native element owns this handler.
     */
    ownerPrefix: string | undefined,
    /**
     * Context of a current loop iteration that this handler is called from.
     */
    loopContext: LoopContext | undefined
};

/**
 * Result for a simple delegate (basically just a passthrough).
 */
type SimpleDelegateResult = {
    /**
     * The kind of delegate.
     */
    kind: 'simple',
    /**
     * The name of the delegated handler.
     */
    name: string
};

/**
 * Result for a member delegate.
 */
type MemberDelegateResult = {
    /**
     * The kind of delegate.
     */
    kind: 'member',
    /**
     * The object that this member is on.
     */
    obj: string,
    /**
     * The member property on the object.
     */
    prop: string
};

/**
 * Result of extractDelegateName — describes what a wrapper function delegates to.
 */
type DelegateResult = SimpleDelegateResult | MemberDelegateResult;

/**
 * A custom component encountered during the walk, with its assigned instance prefix
 * and the resolved prop bindings needed to emit its script declarations.
 */
export type NestedComponentEntry = {
    /**
     * The component function.
     */
    fn: Function,
    /**
     * Unique instance prefix, e.g. 'testButton0_'.
     */
    prefix: string,
    /**
     * The prefix of the immediately enclosing custom component, if any.
     */
    parentPrefix: string | undefined,
    /**
     * LocalName to ResolvedName mappings at the time of the walk, before any prefix renaming is applied.
     *
     * E.g. { onClick: 'increaseCount' } Or { __propsObj_props: '{"onClick":"increaseCount"}' } for non-destructured params.
     */
    propBindings: Record<string, string>,
    /**
     * PropName -> actual value for non-handler, non-children props.
     */
    propValues: Record<string, unknown>,
    /**
     * The component's own destructuring rename map (localName -> propName).
     * Needed to map prop names back to the local name used inside the component body.
     */
    destructureRenameMap: Map<string, string>,
    /**
     * If the component uses a non-destructured param (e.g. `props`), its name.
     */
    propsParamName: string | undefined,
    /**
     * Any bindings that are/should be inlined.
     */
    inlineBindings: Record<string, string>
};

/**
 * Walks a Preact VNode tree, collects event handlers, stamps data-ssr-handlers
 * attributes, and produces a reattachment script section for client-side bootstrap.
 */
export class PreactCollector {
    private seq: number = 0;
    private readonly map: Map<string, HandlerEntry> = new Map();
    private readonly nestedComponents: NestedComponentEntry[] = [];
    private readonly componentCounters: Map<string, number> = new Map();
    private readonly loopContextMap: WeakMap<object, LoopContext> = new WeakMap();
    private readonly handlerRegex: RegExp = /^on/i;

    /**
     * Walks the given virtual dom node recursively and collects any handlers found.
     * @param node - The node to walk.
     * @param parentPrefix - The prefix of the immediately enclosing custom component, if any.
     * @throws When there was an incorrect component setup.
     */
    // eslint-disable-next-line jsdoc/require-jsdoc, sonar/cognitive-complexity
    walk(node: VNode<{ [HANDLERS_DIRECTIVE]?: string }>, parentPrefix: string | undefined): void {
        if (node.type === Fragment) {
            this.walkChildren(node.props.children, parentPrefix);
            return;
        }

        if (typeof node.type === 'function') {
            const propHandlers: Map<string, Function> = new Map();
            const propValues: Record<string, unknown> = {};
            const nonHandlerFns: Map<string, Function> = new Map();

            for (const key of ObjectUtilities.keys(node.props)) {
                if (key === 'children') {
                    continue;
                }
                const val: string | undefined = node.props[key];
                if (this.handlerRegex.test(key)) {
                    if (typeof val === 'function') {
                        propHandlers.set(key, val);
                    }
                }
                else if (typeof val === 'function') {
                    // Non-event function prop — can't be JsonUtilities.stringify'd, handle as inline binding
                    nonHandlerFns.set(key, val);
                }
                else {
                    // Capture non-handler props (className, type, disabled, etc.)
                    propValues[key] = val;
                }
            }

            let rendered: ComponentChild;
            try {
                this.validateSingleParam(node.type);
                const originalMap: typeof Array.prototype.map = Array.prototype.map;
                // eslint-disable-next-line typescript/no-this-alias
                const self: this = this;
                Array.prototype.map = function patchedMap<T, U>(
                    this: T[],
                    cb: (value: T, index: number, array: T[]) => U,
                    thisArg?: unknown
                ): U[] {
                    const varName: string | undefined = self.extractFirstParamName(cb.toString());
                    return originalMap.call(this, (item: T, index: number, arr: T[]) => {
                        const result: U = cb.call(thisArg, item, index, arr);
                        if (varName && result !== null && typeof result === 'object') {
                            self.loopContextMap.set(result as object, { varName, value: item });
                        }
                        return result;
                    }) as U[];
                } as typeof Array.prototype.map;
                try {
                    // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/no-unsafe-call
                    rendered = (node.type as Function)(node.props);
                }
                finally {
                    Array.prototype.map = originalMap;
                }
                if (rendered instanceof Promise) {
                    throw new InternalError(
                        `[ssr] Nested component '${node.type.name}' is async. `
                        + 'Async components are not supported — remove the async keyword and any top-level await. '
                        + 'If you need async data, fetch it before calling render() and pass the result as props.'
                    );
                }
            }
            catch (error) {
                throw new InternalError('collector component render error', { cause: error });
            }

            if (!this.isVNode(rendered)) {
                return;
            }

            const renameMap: Map<string, string> = this.buildPropRenameMap(node.type as Function);
            const propsParamName: string | undefined = this.getPropsParamName(node.type as Function);
            const componentBindings: Record<string, string> = {};
            const inlineBindings: Record<string, string> = {};

            for (const [propName, fn] of nonHandlerFns.entries()) {
                const localName: string = this.reverseLookup(renameMap, propName) ?? propName;
                inlineBindings[localName] = fn.toString();
            }

            if (propHandlers.size) {
                this.substituteHandlers(rendered, propHandlers, renameMap, propsParamName);

                for (const [propName, fn] of propHandlers.entries()) {
                    const result: DelegateResult | undefined = this.extractDelegateName(fn.toString());
                    const localName: string = this.reverseLookup(renameMap, propName) ?? propName;
                    componentBindings[localName] = result?.kind === 'simple' ? result.name : fn.toString();
                }

                if (propsParamName) {
                    const resolvedProps: Record<string, string> = {};
                    for (const [propName, fn] of propHandlers.entries()) {
                        const result: DelegateResult | undefined = this.extractDelegateName(fn.toString());
                        if (result?.kind === 'simple') {
                            resolvedProps[propName] = result.name;
                        }
                    }
                    if (ObjectUtilities.keys(resolvedProps).length) {
                        componentBindings[`__propsObj_${propsParamName}`] = JsonUtilities.stringify(resolvedProps);
                    }
                }
            }

            const prefix: string = this.assignPrefix(node.type as Function);
            this.nestedComponents.push({
                fn: node.type as Function,
                prefix,
                parentPrefix,
                propBindings: componentBindings,
                propValues,
                destructureRenameMap: renameMap,
                propsParamName,
                inlineBindings
            });

            node.type = rendered.type;
            // eslint-disable-next-line jsdoc/require-jsdoc
            node.props = (rendered as VNode<{ [HANDLERS_DIRECTIVE]?: string }>).props;
            // eslint-disable-next-line typescript/no-unsafe-assignment
            node.key = rendered.key;

            this.walk(node, prefix);
            return;
        }

        const handlers: string[] = [];
        for (const key of ObjectUtilities.keys(node.props)) {
            const val: unknown = node.props[key];
            if (this.handlerRegex.test(key) && typeof val === 'function') {
                const event: string = key.slice(2).toLowerCase();
                const loopContext: LoopContext | undefined = this.loopContextMap.get(node) ?? undefined;
                const id: string = this.registerHandler(val, event, parentPrefix, loopContext);
                handlers.push(`${id}:${event}`);
            }
        }

        if (handlers.length) {
            const existing: string = node.props[HANDLERS_DIRECTIVE] ?? '';
            node.props[HANDLERS_DIRECTIVE] = existing
                ? `${existing}|${handlers.join('|')}`
                : handlers.join('|');
        }

        this.walkChildren(node.props.children, parentPrefix);
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private validateSingleParam(fn: Function): void {
        const src: string = fn.toString();
        const firstParen: number = src.indexOf('(');
        if (firstParen === -1) {
            return;
        }

        let depth: number = 0, paramsEnd: number = -1;
        for (let i: number = firstParen; i < src.length; i++) {
            if (src[i] === '(') {
                depth++;
                continue;
            }
            if (src[i] === ')') {
                depth--;
                if (depth === 0) {
                    paramsEnd = i;
                    break;
                }
            }
        }
        if (paramsEnd === -1) {
            return;
        }

        const paramsText: string = src.slice(firstParen + 1, paramsEnd).trim();

        // Count top-level commas — inside a destructure { a, b } these are at depth > 0,
        // so only a genuine second param produces a top-level comma.
        let d: number = 0;
        let inStr: boolean = false;
        let strChar: string = '';
        for (let i: number = 0; i < paramsText.length; i++) {
            const ch: string = paramsText[i];
            const prev: string = paramsText[i - 1];
            if (inStr) {
                if (ch === strChar && prev !== '\\') {
                    inStr = false;
                }
                continue;
            }
            if (ch === '"' || ch === '\'' || ch === '`') {
                inStr = true;
                strChar = ch;
                continue;
            }
            if (ch === '(' || ch === '{' || ch === '[') {
                d++;
            }
            else if (ch === ')' || ch === '}' || ch === ']') {
                d--;
            }
            else if (ch === ',' && d === 0) {
                throw new InternalError(
                    `[ssr] Component '${fn.name}' has multiple parameters. `
                    + 'SSR components must accept a single props object. '
                    + 'Change the signature to ({ prop1, prop2 }: Props) or (props: Props).'
                );
            }
        }
    }

    /**
     * Applies a rename map to all handler sources (word-boundary replacement).
     * Called by PreactUtilities once per nested component, in walk order, so that
     * names declared in outer components are correctly renamed before inner
     * components' prop binding values reference them.
     * @param renameMap - E.g. Map { 'clickAndLog' => 'testButton0_clickAndLog' }.
     * @param componentPrefix - Prefix of the component.
     * @param ancestorMap - Map of any ancestor components.
     */
    applyRenames(renameMap: Map<string, string>, componentPrefix: string, ancestorMap: Map<string, string | undefined>): void {
        const sorted: [string, string][] = [...renameMap.entries()]
            .sort((a, b) => b[0].length - a[0].length);

        for (const [id, entry] of this.map.entries()) {
            if (!this.isInSubtree(entry.ownerPrefix, componentPrefix, ancestorMap)) {
                continue;
            }
            let src: string = entry.src;
            for (const [from, to] of sorted) {
                if (from === entry.loopContext?.varName) {
                    continue;
                }
                // Pass 1 — expand shorthand destructure properties
                src = stringAwareReplace(
                    src,
                    new RegExp(`(?<=[{,]\\s*)${from}(?=\\s*[,}])`, 'g'),
                    () => `${from}: ${to}`
                );
                // Pass 2 — rename remaining references
                src = stringAwareReplace(
                    src,
                    new RegExp(`(?<![\\w$.])${from}(?![\\w$:])`, 'g'),
                    to
                );
            }
            if (src !== entry.src) {
                this.map.set(id, { src, event: entry.event, ownerPrefix: entry.ownerPrefix, loopContext: entry.loopContext });
            }
        }
    }

    private isInSubtree(
        ownerPrefix: string | undefined,
        componentPrefix: string,
        ancestorMap: Map<string, string | undefined>
    ): boolean {
        let current: string | undefined = ownerPrefix;
        while (current !== undefined) {
            if (current === componentPrefix) {
                return true;
            }
            current = ancestorMap.get(current);
        }
        return false;
    }

    /**
     * Returns the nested component entries in walk order (outermost first).
     * @returns The nested component entries as an array.
     */
    getNestedComponentEntries(): NestedComponentEntry[] {
        return this.nestedComponents;
    }

    /**
     * Gets the section in the script responsible for reattaching any handlers of this prefix.
     * @param ownerPrefix - The component prefix.
     * @returns The js section as a string.
     */
    getHandlerReattachmentSectionForPrefix(ownerPrefix: string | undefined): string {
        const filtered: [string, HandlerEntry][] = [...this.map.entries()]
            // eslint-disable-next-line unusedImports/no-unused-vars
            .filter(([_, e]) => e.ownerPrefix === ownerPrefix);

        if (!filtered.length) {
            return '';
        }

        const entries: string[] = filtered.map(([id, e]) => {
            const safeSrc: string = e.src.replaceAll('</script>', '\\u003c/script>');
            const fnExpr: string = e.loopContext
                ? `((${e.loopContext.varName}) => (${safeSrc}))(${this.serializeLoopValue(e.loopContext.value)})`
                : `(${safeSrc})`;
            return `                ${JsonUtilities.stringify(id)}: { event: ${JsonUtilities.stringify(e.event)}, fn: ${fnExpr} }`;
        });

        return [
            '    (function() {',
            '        try {',
            '            const map = {',
            entries.join(',\n'),
            '            };',
            '            for (const id of Object.keys(map)) {',
            '                const info = map[id];',
            '                const { event, fn } = info;',
            `                for (const el of document.querySelectorAll('[${HANDLERS_DIRECTIVE}]')) {`,
            `                    const raw = el.getAttribute('${HANDLERS_DIRECTIVE}');`,
            '                    if (!raw) { continue; }',
            '                    const items = raw.split("|");',
            '                    for (const item of items) {',
            '                        const [handlerId, handlerEvent] = item.split(":");',
            '                        if (handlerId === id) {',
            '                            el.addEventListener(handlerEvent || event, fn);',
            '                        }',
            '                    }',
            '                }',
            '            }',
            '        }',
            '        catch (error) {',
            '            console.error("ssr handler bootstrap error", error);',
            '        }',
            '    })();'
        ].join('\n');
    }

    private assignPrefix(fn: Function): string {
        const raw: string = fn.name?.length ? fn.name : 'component';
        const base: string = raw.charAt(0).toLowerCase() + raw.slice(1);
        const count: number = this.componentCounters.get(base) ?? 0;
        this.componentCounters.set(base, count + 1);
        return `${base}${count}_`;
    }

    private registerHandler(
        fn: Function,
        event: string,
        ownerPrefix: string | undefined,
        loopContext: LoopContext | undefined
    ): string {
        const src: string = fn.toString().replaceAll('</script>', '\\u003c/script>');
        const id: string = `h${++this.seq}`;

        // If there's a loop context we must keep the full source so the IIFE
        // can pass the captured value through. extractDelegateName would discard
        // the argument (e.g. tab.id) and only keep the callee name.
        const srcDelegateName: DelegateResult | undefined = this.extractDelegateName(src);
        const storedSrc: string = loopContext
            ? src
            : srcDelegateName?.kind === 'simple'
                ? srcDelegateName.name
                : src;

        // For simple delegations store just the name; for complex expressions store the full src.
        // Both are renamed uniformly by applyRenames().
        this.map.set(id, {
            event,
            ownerPrefix,
            loopContext,
            src: storedSrc
        });
        return id;
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private substituteHandlers(
        node: VNode,
        propHandlers: Map<string, Function>,
        renameMap: Map<string, string>,
        propsParamName: string | undefined
    ): void {
        if (typeof node.type === 'function' && node.type !== Fragment) {
            return;
        }

        for (const key of ObjectUtilities.keys(node.props)) {
            if (!this.handlerRegex.test(key)) {
                continue;
            }
            const val: ComponentChildren = node.props[key];
            if (typeof val !== 'function') {
                continue;
            }

            const result: DelegateResult | undefined = this.extractDelegateName(val.toString());
            if (!result) {
                continue;
            }

            if (result.kind === 'simple') {
                const propName: string = renameMap.get(result.name) ?? result.name;
                const original: Function | undefined = propHandlers.get(propName);
                if (original) {
                    (node.props as Record<string, unknown>)[key] = original;
                }
            }
            else if (result.kind === 'member' && result.obj === propsParamName) {
                const original: Function | undefined = propHandlers.get(result.prop);
                if (original) {
                    (node.props as Record<string, unknown>)[key] = original;
                }
            }
        }

        const children: ComponentChildren = node.props.children;
        if (children == undefined) {
            return;
        }
        if (this.isVNode(children)) {
            this.substituteHandlers(children, propHandlers, renameMap, propsParamName);
            return;
        }
        if (Array.isArray(children)) {
            for (const c of children) {
                if (this.isVNode(c)) {
                    this.substituteHandlers(c, propHandlers, renameMap, propsParamName);
                }
            }
        }
    }

    private walkChildren(children: ComponentChildren, parentPrefix: string | undefined): void {
        if (children == undefined) {
            return;
        }
        if (this.isVNode(children)) {
            this.walk(children, parentPrefix);
            return;
        }
        if (Array.isArray(children)) {
            for (const c of children) {
                if (this.isVNode(c)) {
                    this.walk(c, parentPrefix);
                }
            }
        }
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private extractDelegateName(fnSrc: string): DelegateResult | undefined {
        let s: string = fnSrc.trim();
        s = s.replace(/^async\s+/, '');

        const arrowMatch: RegExpMatchArray | null = s.match(/^\(([^)]*)\)\s*=>([\S\s]+)$/);
        if (!arrowMatch) {
            return undefined;
        }

        const rawParam: string = arrowMatch[1].trim();
        const paramName: string = rawParam.replace(/\s*:[\S\s]*$/, '').trim();

        let body: string = arrowMatch[2].trim();
        if (body.startsWith('{') && body.endsWith('}')) {
            body = body.slice(1, -1).trim()
                .replace(/;\s*$/, '')
                .trim();
            if (body.includes(';')) {
                return undefined;
            }
        }
        body = body.replace(/^return\s+/, '').trim();
        body = body.replace(/^await\s+/, '').trim();
        body = body.replace(/^void\s+/, '').trim();

        const simpleMatch: RegExpMatchArray | null = body.match(/^(\w+)\s*(?:\?\.)?\s*\(([^)]*)\)\s*$/);
        if (simpleMatch) {
            const calledName: string = simpleMatch[1];
            const callArg: string = (simpleMatch[2] ?? '').trim();
            if (paramName === '' && callArg === '') {
                return { kind: 'simple', name: calledName };
            }
            if (paramName !== '' && callArg === paramName) {
                return { kind: 'simple', name: calledName };
            }
            if (paramName === '' && callArg !== '') {
                return { kind: 'simple', name: calledName };
            }
            return undefined;
        }

        const memberMatch: RegExpMatchArray | null = body.match(/^(\w+)\.(\w+)\s*(?:\?\.)?\s*\(([^)]*)\)\s*$/);
        if (memberMatch) {
            const obj: string = memberMatch[1];
            const prop: string = memberMatch[2];
            const callArg: string = (memberMatch[3] ?? '').trim();
            if (paramName === '' && callArg === '') {
                return { kind: 'member', obj, prop };
            }
            if (paramName !== '' && callArg === paramName) {
                return { kind: 'member', obj, prop };
            }
            if (paramName === '' && callArg !== '') {
                return { kind: 'member', obj, prop };
            }
            return undefined;
        }

        return undefined;
    }

    private getPropsParamName(componentFn: Function): string | undefined {
        const src: string = componentFn.toString();
        const firstParen: number = src.indexOf('(');
        if (firstParen === -1) {
            return undefined;
        }
        let depth: number = 0, paramsEnd: number = -1;
        for (let i: number = firstParen; i < src.length; i++) {
            if (src[i] === '(') {
                depth++;
                continue;
            }
            if (src[i] === ')') {
                depth--;
                if (depth === 0) {
                    paramsEnd = i;
                    break;
                }
            }
        }
        if (paramsEnd === -1) {
            return undefined;
        }
        const paramsText: string = src.slice(firstParen + 1, paramsEnd).trim();
        if (paramsText.startsWith('{')) {
            return undefined;
        }
        const match: RegExpMatchArray | null = paramsText.match(/^([$_a-z]\w*)/i);
        return match ? match[1] : undefined;
    }

    private buildPropRenameMap(componentFn: Function): Map<string, string> {
        const renameMap: Map<string, string> = new Map();
        const src: string = componentFn.toString();
        const firstParen: number = src.indexOf('(');
        if (firstParen === -1) {
            return renameMap;
        }
        let depth: number = 0, paramsEnd: number = -1;
        for (let i: number = firstParen; i < src.length; i++) {
            if (src[i] === '(') {
                depth++;
                continue;
            }
            if (src[i] === ')') {
                depth--;
                if (depth === 0) {
                    paramsEnd = i;
                    break;
                }
            }
        }
        if (paramsEnd === -1) {
            return renameMap;
        }
        const paramsText: string = src.slice(firstParen + 1, paramsEnd);
        const braceOpen: number = paramsText.indexOf('{');
        const braceClose: number = paramsText.lastIndexOf('}');
        if (braceOpen === -1 || braceClose === -1) {
            return renameMap;
        }
        const destructureText: string = paramsText.slice(braceOpen + 1, braceClose);
        const withoutDefaults: string = destructureText.replaceAll(/=\s*(?:{[^}]*}|\[[^\]]*]|[^,}]+)/g, '');
        const renameRegex: RegExp = /\b(\w+)\s*:\s*([$_a-z]\w*)\b/g;
        let match: RegExpExecArray | null;
        while ((match = renameRegex.exec(withoutDefaults)) !== null) {
            renameMap.set(match[2], match[1]);
        }
        return renameMap;
    }

    private reverseLookup(map: Map<string, string>, value: string): string | undefined {
        for (const [k, v] of map.entries()) {
            if (v === value) {
                return k;
            }
        }
        return undefined;
    }

    private isVNode(node: unknown): node is VNode {
        return !(typeof node !== 'object' || !node || !('props' in node));
    }

    private extractFirstParamName(fnSrc: string): string | undefined {
        const s: string = fnSrc.trim().replace(/^async\s+/, '');
        // (tab) => ... or (tab, index) => ...
        const parenMatch: RegExpMatchArray | null = s.match(/^\(([^)]*)\)/);
        if (parenMatch) {
            const param: string = parenMatch[1].trim().split(',')[0].trim();
            return param || undefined;
        }
        // tab => ...
        const bareMatch: RegExpMatchArray | null = s.match(/^([$_a-z]\w*)\s*=>/i);
        return bareMatch ? bareMatch[1] : undefined;
    }

    private serializeLoopValue(value: unknown): string {
        if (typeof value === 'function') {
            return value.toString();
        }
        if (Array.isArray(value)) {
            return `[${value.map(v => this.serializeLoopValue(v)).join(', ')}]`;
        }
        if (value !== null && typeof value === 'object') {
            const entries: string[] = ObjectUtilities.entries(value).map(
                ([k, v]) => `${JsonUtilities.stringify(k)}: ${this.serializeLoopValue(v)}`
            );
            return `{ ${entries.join(', ')} }`;
        }
        return JsonUtilities.stringify(value);
    }
}