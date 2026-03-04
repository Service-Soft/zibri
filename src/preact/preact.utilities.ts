import { VNode } from 'preact';
import renderToString from 'preact-render-to-string';

import { NestedComponentEntry, PreactCollector } from './collector';
import { pkgToFilename } from './generate-client-scripts.function';
import { preactHooks } from './hooks/hooks';
import { PreactComponent } from './preact-component.model';
import { findStringEnd, stringAwareReplace } from './string-aware-replace.function';
import { HtmlResponse } from '../parsing/html/html-response.model';
import { FsUtilities, Path } from '../utilities/fs.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';

/**
 * Definition for a parameter of a preact tsx file.
 */
type ParamDefinition = {
    /**
     * The local name of the parameter.
     */
    localName: string,
    /**
     * The default value of the parameter, if any.
     */
    defaultSrc: string | undefined
};

/**
 * The two parts that make up a component's script section before they are assembled into the final tree.
 */
type ComponentSectionPart = {
    /**
     * The const declarations that bind prop values to prefixed local names, emitted before the labeled block.
     */
    bindingLines: string,
    /**
     * The component body with JSX returns replaced by break statements and variable names prefixed, emitted inside the labeled block.
     */
    cleanBody: string
};

/**
 * Utilities for handling preact templates.
 */
export abstract class PreactUtilities {
    private static clientManifest: Record<string, string[]> | undefined;

    /**
     * Render a component and inline the component "body" (everything before the top-level return)
     * into the same <script> tag that also contains the handler bootstrap.
     * @example
     * ```ts
     * PreactUtilities.render(TestPage, { initialCount: 1 });
     * ```
     * @param args - Component and props.
     * @param args.component - The function component to render.
     * @param args.props - The properties to pass into the component.
     * @returns The fully rendered html string, with the body and any handlers attached in a script tag.
     */
    static async render<P = {}>(
        ...args: keyof P extends never
            ? [component: PreactComponent<P>]
            : [component: PreactComponent<P>, props: P]
    ): Promise<string> {
        const [component, props] = args;
        // ---------- extract component source and prepare inlined script ----------
        const componentSrc: string = component.toString();
        const paramsText: string = this.extractParamsText(componentSrc);
        const bodyText: string = this.extractBodyText(componentSrc);
        const rootPackages: string[] = await this.getPackagesForComponent(component.name);
        const rawBeforeReturn: string = this.rewriteClientImportRefs(
            this.rewriteFrameworkHooks(this.getBodyTextBeforeReturn(bodyText, 'root_')),
            rootPackages
        );
        const propsSection: string = this.getInlinedPropsSection(paramsText, props ?? {});

        const collector: PreactCollector = new PreactCollector();
        const rootVNode: VNode = component(props ?? ({} as P));

        if (rootVNode instanceof Promise) {
            throw new Error(
                `[ssr] The root component '${component.name}' is async. `
                + 'Async components are not supported — remove the async keyword and any top-level await. '
                + 'If you need async data, fetch it before calling render() and pass the result as props.'
            );
        }

        collector.walk(rootVNode, undefined);
        let html: string = renderToString(rootVNode);

        const allPackages: Set<string> = new Set<string>();
        for (const pkg of await this.getPackagesForComponent(component.name)) {
            allPackages.add(pkg);
        }

        // Also collect from nested components
        for (const entry of collector.getNestedComponentEntries()) {
            for (const pkg of await this.getPackagesForComponent(entry.fn.name)) {
                allPackages.add(pkg);
            }
        }

        for (const pkg of allPackages) {
            const tag: string = `<script src="${this.getClientScriptUrl(pkg)}"></script>`;
            html = html.includes('</head>')
                ? html.replace('</head>', `${tag}\n</head>`)
                : tag + '\n' + html;
        }

        // ---------- build nested component script sections ----------
        // Build ancestor map upfront so applyRenames can scope renames to the correct subtree.
        const ancestorMap: Map<string, string | undefined> = new Map(
            collector.getNestedComponentEntries().map(e => [e.prefix, e.parentPrefix])
        );

        const prefixToRenameMap: Map<string, Map<string, string>> = new Map();
        const sectionPartsByPrefix: Map<string, ComponentSectionPart> = new Map();

        for (const entry of collector.getNestedComponentEntries()) {
            const {
                fn,
                prefix,
                parentPrefix,
                propBindings,
                propValues,
                destructureRenameMap,
                propsParamName,
                inlineBindings
            } = entry;

            const fnSrc: string = fn.toString();
            const fnPackages: string[] = await this.getPackagesForComponent(fn.name);
            const body: string = this.rewriteClientImportRefs(
                this.getBodyTextBeforeReturn(this.extractBodyText(fnSrc), prefix),
                fnPackages
            );

            // Build rename map: declared names + all prop local names -> prefixed versions.
            const renameMap: Map<string, string> = this.buildRenameMap(
                body,
                prefix,
                propBindings,
                propsParamName,
                fn,
                inlineBindings
            );
            prefixToRenameMap.set(prefix, renameMap);

            // Apply this component's rename map only to handlers within its own subtree.
            collector.applyRenames(renameMap, prefix, ancestorMap);

            // Emit prop binding + default value declarations for this instance.
            const bindingLines: string = this.buildPropBindingLines(
                prefix,
                propBindings,
                propValues,
                destructureRenameMap,
                propsParamName,
                (v: string) => this.resolveInAncestors(v, prefixToRenameMap, ancestorMap, parentPrefix),
                fn,
                inlineBindings,
                renameMap
            );

            // Apply this component's rename map to its own body text.
            const renamedBody: string = this.applyRenameMap(body, renameMap);

            const cleanBody: string = this.rewriteFrameworkHooks(this.removeJsxReturnStatements(renamedBody, prefix));
            sectionPartsByPrefix.set(prefix, { bindingLines, cleanBody });
        }

        // Nest everything — root body, nested sections, reattachment — inside root_: { }
        // so nested component bindings can close over root-declared variables.
        const rootLevelEntries: NestedComponentEntry[] = collector.getNestedComponentEntries()
            .filter(e => e.parentPrefix === undefined);

        const rootInner: string = [
            rawBeforeReturn,
            ...rootLevelEntries.map(e => this.buildSectionTree(
                e.prefix,
                sectionPartsByPrefix,
                collector.getNestedComponentEntries(),
                prefix => collector.getHandlerReattachmentSectionForPrefix(prefix)
            )),
            collector.getHandlerReattachmentSectionForPrefix(undefined)
        ].filter(s => s.trim()).join('\n');

        const rootBlock: string = this.wrapInLabeledBlock(rootInner, 'root_');

        if (rootBlock.trim() || propsSection.trim()) {
            const hooksSection: string = preactHooks
                .map(fn => fn.toString())
                .filter(s => s.trim())
                .join('\n')
                .split('\n')
                .map(e => `    ${e}`)
                .join('\n');

            const scriptContent: string = [
                `${hooksSection}\n`,
                propsSection,
                rootBlock
            ]
                .filter(Boolean)
                .join('\n')
                .replaceAll('</script>', '\\u003c/script>');

            if (html.includes('</body>')) {
                html = html.replace(
                    '</body>',
                    `<script>\n${scriptContent}\n</script>\n</body>`
                );
            }
            else {
                html += `\n<script>\n${scriptContent}\n</script>`;
            }
        }

        return '<!DOCTYPE html>\n' + html;
    }

    /**
     * Render a component and inline the component "body" (everything before the top-level return)
     * into the same <script> tag that also contains the handler bootstrap. Then wrap it into a html response..
     * @example
     * ```ts
     * PreactUtilities.renderResponse(TestPage, { initialCount: 1 });
     * ```
     * @param args - Component and props.
     * @param args.component - The function component to render.
     * @param args.props - The properties to pass into the component.
     * @returns The fully rendered html as a ready to return html response.
     */
    static async renderResponse<P = {}>(
        ...args: keyof P extends never
            ? [component: PreactComponent<P>]
            : [component: PreactComponent<P>, props: P]
    ): Promise<HtmlResponse> {
        const [component, props] = args;
        // eslint-disable-next-line typescript/no-explicit-any
        const htmlString: string = await this.render<any>(component, props);
        return HtmlResponse.fromString(htmlString);
    }

    private static resolveInAncestors(
        value: string,
        prefixToRenameMap: Map<string, Map<string, string>>,
        ancestorMap: Map<string, string | undefined>,
        startPrefix: string | undefined
    ): string {
        let result: string = value;
        let current: string | undefined = startPrefix;
        while (current !== undefined) {
            const map: Map<string, string> | undefined = prefixToRenameMap.get(current);
            if (map) {
                result = this.applyRenameMap(result, map);
            }
            current = ancestorMap.get(current);
        }
        return result;
    }

    private static buildSectionTree(
        prefix: string,
        parts: Map<string, ComponentSectionPart>,
        allEntries: NestedComponentEntry[],
        getReattachment: (prefix: string) => string
    ): string {
        const { bindingLines, cleanBody } = parts.get(prefix) ?? { bindingLines: '', cleanBody: '' };

        const children: NestedComponentEntry[] = allEntries.filter(e => e.parentPrefix === prefix);
        const childSections: string = children
            .map(c => this.buildSectionTree(c.prefix, parts, allEntries, getReattachment))
            .join('\n');

        const reattachment: string = getReattachment(prefix);

        const blockContents: string = [cleanBody, childSections, reattachment]
            .filter(s => s.trim()).join('\n');
        const wrappedBody: string = this.wrapInLabeledBlock(blockContents, prefix);

        return [bindingLines, wrappedBody].filter(s => s.trim()).join('\n');
    }

    private static async getClientManifest(): Promise<Record<string, string[]>> {
        if (this.clientManifest) {
            return this.clientManifest;
        }
        try {
            const manifestPath: Path = FsUtilities.getPath(process.cwd(), 'assets', 'public', 'vendor', 'manifest.json');
            // eslint-disable-next-line typescript/no-unsafe-assignment
            this.clientManifest = JSON.parse(await FsUtilities.readFile(manifestPath));
        }
        catch {
            this.clientManifest = {};
        }
        return this.clientManifest ?? {};
    }

    private static async getPackagesForComponent(componentName: string): Promise<string[]> {
        return (await this.getClientManifest())[componentName] ?? [];
    }

    private static rewriteClientImportRefs(body: string, packages: string[]): string {
        let result: string = body;
        for (const pkg of packages) {
            const baseVar: string = pkg.replaceAll(/[^\da-z]/gi, '_') + '_client_';
            // Find all variables tsc generated for this package: chart_js_client_1, chart_js_client_2, etc.
            const varPattern: RegExp = new RegExp(
                `(?<![\\w$])${baseVar}(\\d+)(?=[.\\s,;)\\]])`,
                'g'
            );
            const moduleVars: Set<string> = new Set<string>();
            let varMatch: RegExpExecArray | null;
            while ((varMatch = varPattern.exec(result)) !== null) {
                moduleVars.add(`${baseVar}${varMatch[1]}`);
            }
            for (const moduleVar of moduleVars) {
                result = stringAwareReplace(
                    result,
                    new RegExp(`(?<![\\w$])${moduleVar}\\.([\\w$]+)(?![\\w$])`, 'g'),
                    (_match: string, name: string) => name
                );
            }
        }
        return result;
    }

    private static getClientScriptUrl(pkg: string): string {
        return `/assets/vendor/${pkgToFilename(pkg)}`;
    }

    private static rewriteFrameworkHooks(body: string): string {
        let result: string = body;
        for (const hook of preactHooks) {
            result = stringAwareReplace(result, new RegExp(`(?:\\(0,\\s*)?\\w*zibri\\w*_\\d+\\.${hook.name}\\)?(?=\\()`, 'g'), hook.name);
        }
        return result;
    }

    private static getBodyTextBeforeReturn(bodyText: string, label: string): string {
        if (!bodyText.length) {
            return '';
        }
        const candidate: string = this.findBeforeTopLevelReturn(bodyText);
        return this.removeJsxReturnStatements(candidate, label);
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private static removeJsxReturnStatements(body: string, label: string): string {
        let result: string = '';
        let i: number = 0;
        let inSingle: boolean = false, inDouble: boolean = false, inTemplate: boolean = false;
        let inLine: boolean = false, inBlock: boolean = false;

        while (i < body.length) {
            const ch: string = body[i];
            const prev: string = body[i - 1];

            if (inLine) {
                if (ch === '\n') {
                    inLine = false;
                }
                result += ch;
                i++;
                continue;
            }
            if (inBlock) {
                if (prev === '*' && ch === '/') {
                    inBlock = false;
                }
                result += ch;
                i++;
                continue;
            }

            if (!inSingle && !inDouble && !inTemplate) {
                if (ch === '/' && body[i + 1] === '/') {
                    inLine = true;
                    result += ch;
                    i++;
                    continue;
                }
                if (ch === '/' && body[i + 1] === '*') {
                    inBlock = true;
                    result += ch;
                    i++;
                    continue;
                }
            }
            if (!inLine && !inBlock) {
                if (!inDouble && !inTemplate && ch === '\'' && prev !== '\\') {
                    inSingle = !inSingle;
                    result += ch;
                    i++;
                    continue;
                }
                if (!inSingle && !inTemplate && ch === '"' && prev !== '\\') {
                    inDouble = !inDouble;
                    result += ch;
                    i++;
                    continue;
                }
                if (!inSingle && !inDouble && ch === '`' && prev !== '\\') {
                    inTemplate = !inTemplate;
                    result += ch;
                    i++;
                    continue;
                }
            }
            if (inSingle || inDouble || inTemplate) {
                result += ch;
                i++;
                continue;
            }

            // At a return keyword — check if it returns JSX
            if (/^return\b/.test(body.slice(i))) {
                const stmtEnd: number = this.findReturnStatementEnd(body, i);
                const stmt: string = body.slice(i, stmtEnd);
                if (this.isJsxReturn(stmt)) {
                    result += `break ${label};`;
                    i = stmtEnd;
                    continue;
                }
            }

            result += ch;
            i++;
        }

        return result;
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private static findReturnStatementEnd(body: string, start: number): number {
        let i: number = start + 'return'.length;
        let depth: number = 0;
        let inSingle: boolean = false, inDouble: boolean = false, inTemplate: boolean = false;

        while (i < body.length) {
            const ch: string = body[i];
            const prev: string = body[i - 1];

            if (!inDouble && !inTemplate && ch === '\'' && prev !== '\\') {
                inSingle = !inSingle;
                i++;
                continue;
            }
            if (!inSingle && !inTemplate && ch === '"' && prev !== '\\') {
                inDouble = !inDouble;
                i++;
                continue;
            }
            if (!inSingle && !inDouble && ch === '`' && prev !== '\\') {
                inTemplate = !inTemplate;
                i++;
                continue;
            }
            if (inSingle || inDouble || inTemplate) {
                i++;
                continue;
            }

            if (ch === '(' || ch === '{' || ch === '[') {
                depth++;
            }
            else if (ch === ')' || ch === '}' || ch === ']') {
                if (depth === 0) {
                    return i;
                } // hit enclosing block's closing brace
                depth--;
            }
            else if (ch === ';' && depth === 0) {
                return i + 1;
            }

            i++;
        }

        return i;
    }

    private static isJsxReturn(stmt: string): boolean {
    // Matches compiled TSX output from tsc + preact/jsx-runtime
        return stmt.includes('jsx_runtime')
            || stmt.includes('_jsx(')
            // eslint-disable-next-line cspell/spellchecker
            || stmt.includes('_jsxs(')
            || stmt.includes('jsxDEV(');
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private static findBeforeTopLevelReturn(bodyText: string): string {
        // extract up to top-level return
        let i: number = 0;
        let depth: number = 0;
        let inSingle: boolean = false;
        let inDouble: boolean = false;
        let inTemplate: boolean = false;
        let inLine: boolean = false;
        let inBlock: boolean = false;
        while (i < bodyText.length) {
            const ch: string = bodyText[i];
            const prev: string = bodyText[i - 1];
            if (inLine) {
                if (ch === '\n') {
                    inLine = false;
                }
                i++;
                continue;
            }
            if (inBlock) {
                if (prev === '*' && ch === '/') {
                    inBlock = false;
                }
                i++;
                continue;
            }
            if (!inSingle && !inDouble && !inTemplate) {
                if (ch === '/' && bodyText[i + 1] === '/') {
                    inLine = true;
                    i++;
                    continue;
                }
                if (ch === '/' && bodyText[i + 1] === '*') {
                    inBlock = true;
                    i++;
                    continue;
                }
            }
            if (!inLine && !inBlock) {
                if (!inDouble && !inTemplate && ch === '\'' && prev !== '\\') {
                    inSingle = !inSingle;
                    i++;
                    continue;
                }
                if (!inSingle && !inTemplate && ch === '"' && prev !== '\\') {
                    inDouble = !inDouble;
                    i++;
                    continue;
                }
                if (!inSingle && !inDouble && ch === '`' && prev !== '\\') {
                    inTemplate = !inTemplate;
                    i++;
                    continue;
                }
            }
            if (inSingle || inDouble || inTemplate || inLine || inBlock) {
                i++;
                continue;
            }
            if (ch === '{') {
                depth++;
            }
            else if (ch === '}') {
                depth = Math.max(0, depth - 1);
            }
            else if (depth === 0 && /^return\b/.test(bodyText.slice(i))) {
                return bodyText.slice(0, i);
            }
            i++;
        }
        return bodyText;
    }

    private static extractParamsText(src: string): string {
        const firstParen: number = src.indexOf('(');
        if (firstParen === -1) {
            return '';
        }

        // find matching ) for params (simple paren matcher)
        let depth: number = 0;
        let paramsEnd: number = -1;
        for (let i: number = firstParen; i < src.length; i++) {
            const ch: string = src[i];
            if (ch === '(') {
                depth++;
                continue;
            }
            if (ch === ')') {
                depth--;
                if (depth === 0) {
                    paramsEnd = i;
                    break;
                }
            }
        }
        if (paramsEnd === -1) {
            return '';
        }
        return src.slice(firstParen + 1, paramsEnd).trim();
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private static extractBodyText(src: string): string {
        const firstParen: number = src.indexOf('(');
        if (firstParen === -1) {
            return '';
        }

        // find matching ) for params (simple paren matcher)
        let depth: number = 0;
        let paramsEnd: number = -1;
        for (let i: number = firstParen; i < src.length; i++) {
            const ch: string = src[i];
            if (ch === '(') {
                depth++;
                continue;
            }
            if (ch === ')') {
                depth--;
                if (depth === 0) {
                    paramsEnd = i;
                    break;
                }
            }
        }
        if (paramsEnd === -1) {
            return '';
        }

        // find body braces
        const braceStart: number = src.indexOf('{', paramsEnd);
        if (braceStart === -1) {
            return '';
        }

        // match closing brace (handle simple string/comment cases enough for typical components)
        depth = 0;
        let inSingle: boolean = false;
        let inDouble: boolean = false;
        let inTemplate: boolean = false;
        let inLine: boolean = false;
        let inBlock: boolean = false;

        for (let pos: number = braceStart; pos < src.length; pos++) {
            const ch: string = src[pos];
            const prev: string = src[pos - 1];

            if (inLine) {
                if (ch === '\n') {
                    inLine = false;
                }
                continue;
            }
            if (inBlock) {
                if (prev === '*' && ch === '/') {
                    inBlock = false;
                }
                continue;
            }

            if (!inSingle && !inDouble && !inTemplate) {
                if (ch === '/' && src[pos + 1] === '/') {
                    inLine = true;
                    pos++;
                    continue;
                }
                if (ch === '/' && src[pos + 1] === '*') {
                    inBlock = true;
                    pos++;
                    continue;
                }
            }
            if (!inLine && !inBlock) {
                if (!inDouble && !inTemplate && ch === '\'' && prev !== '\\') {
                    inSingle = !inSingle;
                }
                else if (!inSingle && !inTemplate && ch === '"' && prev !== '\\') {
                    inDouble = !inDouble;
                }
                else if (!inSingle && !inDouble && ch === '`' && prev !== '\\') {
                    inTemplate = !inTemplate;
                }
            }

            if (inSingle || inDouble || inTemplate || inLine || inBlock) {
                continue;
            }

            if (ch === '{') {
                depth++;
            }
            else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    return src.slice(braceStart + 1, pos);
                }
            }
        }

        return '';
    }

    private static getInlinedPropsSection(paramsText: string, propsObj: Record<string, unknown>): string {
        // Separate functions from serializable values
        const fnProps: Record<string, string> = {};
        const serializableProps: Record<string, unknown> = {};

        for (const [key, val] of Object.entries(propsObj)) {
            if (typeof val === 'function') {
                fnProps[key] = val.toString();
            }
            else {
                serializableProps[key] = val;
            }
        }

        const safe: string = JSON.stringify(serializableProps, undefined, 4)
            .split('\n')
            .map((l, i) => i === 0 ? l : '    ' + l)
            .join('\n')
            .replaceAll('<', '\\u003c');

        const lines: string[] = [`    const __PROPS = ${safe};`];

        // Emit function props as standalone consts — they can't be JSON-serialized
        for (const [key, src] of Object.entries(fnProps)) {
            lines.push(`    const ${key} = ${src};`);
        }

        const trimmed: string = paramsText.trim();
        if (!paramsText.length) {
            return lines.join('\n');
        }

        if (trimmed.startsWith('{')) {
            const inside: string = trimmed.replaceAll(/^{\s*|\s*}$/g, '');
            const keys: string[] = this.splitTopLevelTokens(inside)
                .map(s => {
                    const parts: string[] = s.trim().split(':');
                    const propName: string = parts[0].trim();
                    const maybeLocal: string = (parts[1] ?? '').trim();
                    if (maybeLocal && /^[$_a-z]\w*$/i.test(maybeLocal)) {
                        return `${propName}: ${maybeLocal}`;
                    }
                    return propName;
                })
                .filter(Boolean)
                // Only destructure from __PROPS — function props are already declared as consts
                .filter(k => {
                    const propName: string = k.split(':')[0].trim();
                    return !(propName in fnProps);
                })
                .filter(k => /^[$_a-z]\w*(?:\s*:\s*[$_a-z]\w*)?$/i.test(k.trim()));

            if (keys.length) {
                lines.push(`    const { ${keys.join(', ')} } = __PROPS;`);
            }
            return lines.join('\n');
        }

        const firstName: string = trimmed.split(',')[0].split('=')[0].trim();
        if (firstName.length && /^[$_a-z]\w*$/i.test(firstName)) {
            lines.push(`    const ${firstName} = __PROPS.${firstName} !== undefined ? __PROPS.${firstName} : __PROPS;`);
        }

        return lines.join('\n');
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private static buildRenameMap(
        strippedBody: string,
        prefix: string,
        propBindings: Record<string, string>,
        propsParamName: string | undefined,
        componentFn: Function,
        inlineBindings: Record<string, string>
    ): Map<string, string> {
        const renameMap: Map<string, string> = new Map();

        // Declared names in the body
        const declPatterns: RegExp[] = [
            /\b(?:let|const|var)\s+([$A-Z_a-z]\w*)/g,
            /\bfunction\s*\*?\s*([$A-Z_a-z]\w*)\s*\(/g,
            /\bclass\s+([$A-Z_a-z]\w*)/g
        ];
        const blankedBody: string = this.blankStringsAndComments(strippedBody);
        for (const pattern of declPatterns) {
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(blankedBody)) !== null) {
                renameMap.set(match[1], `${prefix}${match[1]}`);
            }
        }

        for (const { inner } of this.findDestructurePatterns(blankedBody)) {
            for (const name of this.extractDestructuredNames(inner)) {
                renameMap.set(name, `${prefix}${name}`);
            }
        }

        // Handler prop local names (from propBindings)
        for (const key of ObjectUtilities.keys(propBindings)) {
            if (key.startsWith('__propsObj_')) {
                const paramName: string = key.replace('__propsObj_', '');
                renameMap.set(paramName, `${prefix}${paramName}`);
            }
            else {
                renameMap.set(key, `${prefix}${key}`);
            }
        }

        for (const localName of ObjectUtilities.keys(inlineBindings)) {
            renameMap.set(localName, `${prefix}${localName}`);
        }

        if (propsParamName) {
            renameMap.set(propsParamName, `${prefix}${propsParamName}`);
        }
        else {
            // ALL destructured param names — including those using defaults not passed by parent
            const allParams: ParamDefinition[] = this.extractAllParamEntries(componentFn.toString());
            for (const { localName } of allParams) {
                if (localName && localName !== 'children') {
                    renameMap.set(localName, `${prefix}${localName}`);
                }
            }
        }

        return renameMap;
    }

    private static blankStringsAndComments(text: string): string {
        let result: string = '';
        let i: number = 0;
        while (i < text.length) {
            if (text[i] === '"' || text[i] === '\'' || text[i] === '`') {
                const end: number = findStringEnd(text, i, text[i]);
                result += ' '.repeat(end - i);
                i = end;
            }
            else if (text[i] === '/' && text[i + 1] === '/') {
                const end: number = text.indexOf('\n', i);
                const commentEnd: number = end === -1 ? text.length : end;
                result += ' '.repeat(commentEnd - i);
                i = commentEnd;
            }
            else if (text[i] === '/' && text[i + 1] === '*') {
                const end: number = text.indexOf('*/', i + 2);
                const commentEnd: number = end === -1 ? text.length : end + 2;
                result += ' '.repeat(commentEnd - i);
                i = commentEnd;
            }
            else {
                result += text[i];
                i++;
            }
        }
        return result;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    private static findDestructurePatterns(body: string): { inner: string, isArray: boolean }[] {
    // eslint-disable-next-line jsdoc/require-jsdoc
        const results: { inner: string, isArray: boolean }[] = [];
        const pattern: RegExp = /\b(?:let|const|var)\s*([[{])/g;
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(body)) !== null) {
            const isArray: boolean = match[1] === '[';
            const open: string = match[1];
            const close: string = isArray ? ']' : '}';
            let depth: number = 1;
            let i: number = match.index + match[0].length;

            while (i < body.length && depth > 0) {
                if (body[i] === open) {
                    depth++;
                }
                else if (body[i] === close) {
                    depth--;
                }
                i++;
            }

            const inner: string = body.slice(match.index + match[0].length, i - 1);
            results.push({ inner, isArray });
        }

        return results;
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private static extractDestructuredNames(destructureText: string): string[] {
        const names: string[] = [];

        const tokens: string[] = this.splitTopLevelTokens(destructureText);

        for (const token of tokens) {
            if (!token) {
                continue;
            }
            // Strip default value at depth 0
            let eqIdx: number = -1;
            let ed: number = 0;
            let inS: boolean = false;
            let sChar: string = '';
            for (let i: number = 0; i < token.length; i++) {
                const ch: string = token[i];
                const prev: string = token[i - 1];
                if (inS) {
                    if (ch === sChar && prev !== '\\') {
                        inS = false;
                    }
                    continue;
                }
                if (ch === '"' || ch === '\'' || ch === '`') {
                    inS = true;
                    sChar = ch;
                    continue;
                }
                if (ch === '(' || ch === '{' || ch === '[') {
                    ed++;
                }
                else if (ch === ')' || ch === '}' || ch === ']') {
                    ed--;
                }
                else if (ch === '=' && ed === 0 && token[i + 1] !== '>') {
                    eqIdx = i;
                    break;
                }
            }
            const withoutDefault: string = (eqIdx !== -1 ? token.slice(0, eqIdx) : token).trim();

            // Nested object destructure: { a, b: localB }
            if (withoutDefault.startsWith('{')) {
                const inner: string = withoutDefault.slice(1, withoutDefault.lastIndexOf('}')).trim();
                names.push(...this.extractDestructuredNames(inner));
                continue;
            }
            // Nested array destructure: [a, b]
            if (withoutDefault.startsWith('[')) {
                const inner: string = withoutDefault.slice(1, withoutDefault.lastIndexOf(']')).trim();
                names.push(...this.extractDestructuredNames(inner));
                continue;
            }
            // Rename: propName: localName — take the local name (right side)
            const colonIdx: number = withoutDefault.indexOf(':');
            if (colonIdx !== -1) {
                const afterColon: string = withoutDefault.slice(colonIdx + 1).trim();
                // Only treat as rename if right side is a plain identifier, not a type
                if (/^[$_a-z]\w*$/i.test(afterColon)) {
                    names.push(afterColon);
                }
                // Otherwise it's a TypeScript type annotation — left side is the local name
                else {
                    const beforeColon: string = withoutDefault.slice(0, colonIdx).trim();
                    if (/^[$_a-z]\w*$/i.test(beforeColon)) {
                        names.push(beforeColon);
                    }
                }
                continue;
            }
            // Plain identifier: possibly with rest spread ...name
            const plain: string = withoutDefault.replace(/^\.{3}/, '').trim();
            if (/^[$_a-z]\w*$/i.test(plain)) {
                names.push(plain);
            }
        }

        return names;
    }

    private static wrapInLabeledBlock(body: string, prefix: string): string {
        const indented: string = body
            .split('\n')
            .filter(s => s.trim())
            .map(l => `    ${l}`)
            .join('\n');
        return indented.trim()
            ? `    ${prefix}: {\n${indented}\n    }\n`
            : '';
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private static buildPropBindingLines(
        prefix: string,
        propBindings: Record<string, string>,
        propValues: Record<string, unknown>,
        destructureRenameMap: Map<string, string>,
        propsParamName: string | undefined,
        resolveValue: (v: string) => string,
        componentFn: Function,
        inlineBindings: Record<string, string>,
        ownRenameMap: Map<string, string>
    ): string {
        const lines: string[] = [];

        if (propsParamName) {
        // Non-destructured param: reconstruct the full props object
            const entries: string[] = [];

            for (const [key, value] of ObjectUtilities.entries(propBindings)) {
                if (key.startsWith('__propsObj_')) {
                    // eslint-disable-next-line typescript/no-unsafe-assignment
                    const parsed: Record<string, string> = JSON.parse(value);
                    for (const [propName, resolvedName] of ObjectUtilities.entries(parsed)) {
                        entries.push(`${propName}: ${resolveValue(resolvedName)}`);
                    }
                }
                else {
                    entries.push(`${key}: ${resolveValue(value)}`);
                }
            }

            // Inline bindings go into the props object too
            for (const [localName, src] of ObjectUtilities.entries(inlineBindings)) {
                const resolvedSrc: string = resolveValue(src);
                // Reverse-lookup to get the prop name for this local name
                const propName: string = destructureRenameMap.get(localName) ?? localName;
                entries.push(`${propName}: ${resolvedSrc}`);
            }

            for (const [propName, val] of ObjectUtilities.entries(propValues)) {
                entries.push(`${propName}: ${JSON.stringify(val)}`);
            }

            if (entries.length) {
                lines.push(`    const ${prefix}${propsParamName} = { ${entries.join(', ')} };`);
            }
        }
        else {
        // Destructured param: emit one const per prop local name

            // Handler bindings — simple delegations resolved to a name
            for (const [key, value] of ObjectUtilities.entries(propBindings)) {
                if (key.startsWith('__propsObj_')) {
                    continue;
                }
                lines.push(`    const ${prefix}${key} = ${resolveValue(value)};`);
            }

            // Inline bindings — complex expressions emitted as named consts with
            // parentRenameMap applied so references to parent-scope names are resolved
            for (const [localName, src] of ObjectUtilities.entries(inlineBindings)) {
                const resolvedSrc: string = resolveValue(src);
                lines.push(`    const ${prefix}${localName} = ${resolvedSrc};`);
            }

            // All declared params — emit passed value, or default, or skip
            const allParams: ParamDefinition[] = this.extractAllParamEntries(componentFn.toString());

            for (const { localName, defaultSrc } of allParams) {
                if (!localName || localName === 'children') {
                    continue;
                }
                // Skip if already emitted as a handler or inline binding
                if (localName in propBindings || localName in inlineBindings) {
                    continue;
                }

                const propName: string = destructureRenameMap.get(localName) ?? localName;

                if (propName in propValues) {
                    lines.push(`    const ${prefix}${localName} = ${JSON.stringify(propValues[propName])};`);
                    continue;
                }
                if (defaultSrc !== undefined) {
                    // Apply own rename map so `id = label` becomes `checkbox0_id = checkbox0_label`
                    const renamedDefault: string = this.applyRenameMap(defaultSrc, ownRenameMap);
                    lines.push(`    const ${prefix}${localName} = ${renamedDefault};`);
                    continue;
                }
                lines.push(`    const ${prefix}${localName} = undefined;`);
            }
        }

        return lines.join('\n');
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private static extractAllParamEntries(fnSrc: string): ParamDefinition[] {
        const results: ParamDefinition[] = [];

        const firstParen: number = fnSrc.indexOf('(');
        if (firstParen === -1) {
            return results;
        }

        let depth: number = 0, paramsEnd: number = -1;
        for (let i: number = firstParen; i < fnSrc.length; i++) {
            if (fnSrc[i] === '(') {
                depth++;
            }
            else if (fnSrc[i] === ')') {
                depth--;
                if (depth === 0) {
                    paramsEnd = i;
                    break;
                }
            }
        }
        if (paramsEnd === -1) {
            return results;
        }

        const paramsText: string = fnSrc.slice(firstParen + 1, paramsEnd).trim();
        if (!paramsText.startsWith('{')) {
            return results;
        }

        const braceOpen: number = paramsText.indexOf('{');
        const braceClose: number = paramsText.lastIndexOf('}');
        if (braceOpen === -1 || braceClose === -1) {
            return results;
        }

        const destructureText: string = paramsText.slice(braceOpen + 1, braceClose);

        // Use the same top-level comma splitter from extractDestructuredNames
        const tokens: string[] = this.splitTopLevelTokens(destructureText);

        for (const token of tokens) {
            if (!token) {
                continue;
            }

            // Extract default value at depth 0 — same logic as before
            let eqIdx: number = -1;
            let ed: number = 0;
            let inS: boolean = false;
            let sChar: string = '';
            for (let i: number = 0; i < token.length; i++) {
                const ch: string = token[i];
                const prev: string = token[i - 1];
                if (inS) {
                    if (ch === sChar && prev !== '\\') {
                        inS = false;
                    }
                    continue;
                }
                if (ch === '"' || ch === '\'' || ch === '`') {
                    inS = true;
                    sChar = ch;
                    continue;
                }
                if (ch === '(' || ch === '{' || ch === '[') {
                    ed++;
                }
                else if (ch === ')' || ch === '}' || ch === ']') {
                    ed--;
                }
                else if (ch === '=' && ed === 0 && token[i + 1] !== '>') {
                    eqIdx = i;
                    break;
                }
            }

            const withoutDefault: string = (eqIdx !== -1 ? token.slice(0, eqIdx) : token).trim();
            const defaultSrc: string | undefined = eqIdx !== -1
                ? token.slice(eqIdx + 1).trim()
                : undefined;

            // Delegate name extraction to extractDestructuredNames
            const names: string[] = this.extractDestructuredNames(withoutDefault);
            // For top-level params we only want the single local name
            const localName: string = names[0] ?? '';

            if (localName) {
                results.push({ localName, defaultSrc });
            }
        }

        return results;
    }

    private static splitTopLevelTokens(text: string): string[] {
        const tokens: string[] = [];
        let tokenStart: number = 0;
        let depth: number = 0;
        let inStr: boolean = false;
        let strChar: string = '';

        for (let i: number = 0; i < text.length; i++) {
            const ch: string = text[i];
            const prev: string = text[i - 1];
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
                depth++;
            }
            else if (ch === ')' || ch === '}' || ch === ']') {
                depth--;
            }
            else if (ch === ',' && depth === 0) {
                tokens.push(text.slice(tokenStart, i).trim());
                tokenStart = i + 1;
            }
        }
        tokens.push(text.slice(tokenStart).trim());
        return tokens;
    }

    private static applyRenameMap(text: string, renameMap: Map<string, string>): string {
        const sorted: [string, string][] = [...renameMap.entries()]
            .sort((a, b) => b[0].length - a[0].length);
        let result: string = text;

        for (const [from, to] of sorted) {
            // Expand to explicit form { from: to } so the key is preserved.
            result = stringAwareReplace(
                result,
                new RegExp(`(?<=[{,]\\s*)${from}(?=\\s*[,}])`, 'g'),
                () => `${from}: ${to}`
            );
            // rename remaining references (variable uses, not property keys)
            result = stringAwareReplace(
                result,
                new RegExp(`(?<![\\w$.])${from}(?![\\w$:])`, 'g'),
                to
            );
        }
        return result;
    }
}