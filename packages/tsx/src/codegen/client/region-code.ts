import * as ts from 'typescript';

import { attributeExpression, attributesOf, isComponentName, isEventHandlerName, tagNameOf } from './handlers';
import { SETUP_RUNTIME_PARAM } from './reattach';
import { containsJsx, JsxMarkup, PartPropKind, RegionCollection, RegionForm, RegionSite, resolveForm } from './regions';
import { toScriptValue } from '../../runtime/script-value';
import { collectPatternNames } from '../../semantics/binding';
import { decodeJsxEntities, normalizeJsxText } from '../server/jsx-text';
import { printClientNode } from '../server/print';

/**
 * The client-side bootstrap that hands the page the conditions and lists this instance renders: for each region entry
 * it was rendered with, the description of its markup made with the values the entry captured. The page takes over
 * the nodes the server rendered for it, and renders it again whenever a state changes (`__zibriRegion`).
 */
export const REGION_RUNTIME: string = `(function () {
    var entries = (${SETUP_RUNTIME_PARAM} && ${SETUP_RUNTIME_PARAM}.regions) || [];
    for (var i = 0; i < entries.length; i++) {
        var def = __regionSites[entries[i].site];
        if (def) { __zibriRegion(entries[i].id, def.make.apply(null, entries[i].captured || []), ${SETUP_RUNTIME_PARAM}.templates); }
    }
})();`;

/**
 * What a description is printed with: the two-way attributes, and what the regions of the component hold that only the
 * server renders.
 */
type Describing = Pick<RegionCollection, 'twoWay' | 'forms' | 'partProps' | 'opaque'>;

/**
 * The letter a description marks a prop of a component with, by how the page follows it.
 */
const PART_PROP_KINDS: Readonly<Record<PartPropKind, string>> = { value: 'v', state: 's', function: 'f' };

/**
 * The row of a list a description is inside, whose current item its code reads.
 */
type RowScope = {
    /**
     * The variable holding the row: its item and its index.
     */
    variable: string,
    /**
     * The parameters of the function rendering the row.
     */
    parameters: readonly ts.ParameterDeclaration[]
};

/**
 * Builds the `__regionSites` table: for each region, a factory taking the values it captured and returning the
 * description of its markup, whose getters read the current state, and in a row its current item.
 * @param sites - The regions.
 * @param describing - The attributes in them holding a state itself that binds both ways, and what they hold that only
 * the server renders.
 * @returns The table source (empty when there are no regions).
 */
export function regionTable(sites: RegionSite[], describing: Describing): string {
    if (sites.length === 0) {
        return '';
    }
    const entries: string[] = sites.map(site => `${site.id}: { make: (${site.captureVars.join(', ')}) => (${describeForm(site.expression, site.form, [], describing)}) }`);
    return `const __regionSites = {\n${entries.join(',\n')}\n};`;
}

/**
 * Describes a condition or a list.
 * @param expression - The expression of the form.
 * @param form - The form.
 * @param rows - The rows it is inside.
 * @param describing - What the regions hold.
 * @returns The description's source.
 */
function describeForm(expression: ts.Expression, form: RegionForm, rows: RowScope[], describing: Describing): string {
    // the id the server renders its templates under
    const id: string = toScriptValue(describing.forms.get(expression) ?? '');
    if (form.kind === 'if') {
        const branch: (markup: JsxMarkup | undefined) => string = markup => markup === undefined ? 'null' : describeMarkup(markup, rows, describing);
        return `{ k: 'if', id: ${id}, c: ${getter(printClientNode(form.condition), rows)}, y: ${branch(form.whenTrue)}, n: ${branch(form.whenFalse)} }`;
    }
    const row: RowScope = { variable: `__row${rows.length}`, parameters: form.callback.parameters };
    const inner: RowScope[] = [...rows, row];
    return `{ k: 'map', id: ${id}, l: ${getter(printClientNode(form.list), rows)}, `
        + `row: (${row.variable}) => (${describeMarkup(form.row, inner, describing)}), `
        + `key: (${row.variable}) => { ${prelude(inner)}return (${printClientNode(form.key)}); } }`;
}

/**
 * Describes a component: the html the server renders for it, the props it is handed that the page follows, each with
 * a getter, and the children it places.
 * @param markup - The component element.
 * @param rows - The rows it is inside.
 * @param describing - What the regions hold.
 * @returns The description's source.
 */
function describeComponent(markup: ts.JsxElement | ts.JsxSelfClosingElement, rows: RowScope[], describing: Describing): string {
    const props: string[] = attributesOf(markup).flatMap(attribute => {
        const kind: PartPropKind | undefined = ts.isJsxAttribute(attribute) ? describing.partProps.get(attribute) : undefined;
        const expression: ts.Expression | undefined = ts.isJsxAttribute(attribute) ? attributeExpression(attribute) : undefined;
        return kind === undefined || expression === undefined || !ts.isJsxAttribute(attribute)
            ? []
            : [`${toScriptValue(attribute.name.getText())}: [${toScriptValue(PART_PROP_KINDS[kind])}, ${getter(printClientNode(expression), rows)}]`];
    });
    const children: string[] = ts.isJsxElement(markup) ? describeChildren(markup.children, rows, describing) : [];
    return `{ q: { ${props.join(', ')} }, ch: ${children.length === 0 ? 'undefined' : `[${children.join(', ')}]`} }`;
}

/**
 * Describes an element or a fragment.
 * @param markup - The element or fragment.
 * @param rows - The rows it is inside.
 * @param describing - What the regions hold.
 * @returns The description's source.
 */
function describeMarkup(markup: JsxMarkup, rows: RowScope[], describing: Describing): string {
    if (ts.isJsxFragment(markup)) {
        return `{ f: [${describeChildren(markup.children, rows, describing).join(', ')}] }`;
    }
    if (isComponentName(tagNameOf(markup))) {
        return describeComponent(markup, rows, describing);
    }
    const attributes: string[] = [];
    const spreads: string[] = [];
    const handlers: string[] = [];
    const writes: string[] = [];
    let ref: string | undefined;
    for (const attribute of attributesOf(markup)) {
        if (ts.isJsxSpreadAttribute(attribute)) {
            spreads.push(getter(printClientNode(attribute.expression), rows));
            continue;
        }
        const name: string = attribute.name.getText();
        const expression: ts.Expression | undefined = attributeExpression(attribute);
        if (name === 'key') {
            continue;
        }
        if (isEventHandlerName(name)) {
            if (expression !== undefined) {
                handlers.push(`[${toScriptValue(name.slice(2).toLowerCase())}, ${getter(printClientNode(expression), rows)}]`);
            }
            continue;
        }
        if (name === 'ref') {
            ref = expression === undefined ? undefined : getter(printClientNode(expression), rows);
            continue;
        }
        attributes.push(`[${toScriptValue(name)}, ${getter(attributeSource(attribute, expression, describing.twoWay), rows)}]`);
        if (expression !== undefined && describing.twoWay.has(expression)) {
            writes.push(`[${toScriptValue(name)}, ${getter(printClientNode(expression), rows)}]`);
        }
    }
    const children: readonly ts.JsxChild[] = ts.isJsxElement(markup) ? markup.children : [];
    return `{ t: ${toScriptValue(tagNameOf(markup).getText())}, a: [${attributes.join(', ')}], s: [${spreads.join(', ')}], `
        + `on: [${handlers.join(', ')}], w: [${writes.join(', ')}], r: ${ref ?? 'undefined'}, `
        + `c: [${describeChildren(children, rows, describing).join(', ')}] }`;
}

/**
 * The source of the value of an attribute: `true` for one written without a value, the text of a string, the value of
 * a state that binds both ways, or the expression.
 * @param attribute - The attribute.
 * @param expression - Its expression, if it has one.
 * @param twoWay - The two-way attributes.
 * @returns The source.
 */
function attributeSource(attribute: ts.JsxAttribute, expression: ts.Expression | undefined, twoWay: ReadonlySet<ts.Expression>): string {
    const initializer: ts.JsxAttributeValue | undefined = attribute.initializer;
    if (initializer === undefined) {
        return 'true';
    }
    if (ts.isStringLiteral(initializer)) {
        return toScriptValue(decodeJsxEntities(initializer.text));
    }
    if (expression === undefined) {
        return 'undefined';
    }
    return twoWay.has(expression) ? `(${printClientNode(expression)}).value` : printClientNode(expression);
}

/**
 * Describes the children of an element or a fragment: its text, its holes, the conditions and lists in it, and its
 * elements.
 * @param children - The children.
 * @param rows - The rows they are inside.
 * @param describing - What the regions hold.
 * @returns The descriptions' sources.
 */
function describeChildren(children: readonly ts.JsxChild[], rows: RowScope[], describing: Describing): string[] {
    return children.flatMap(child => {
        if (ts.isJsxText(child)) {
            const text: string = decodeJsxEntities(normalizeJsxText(child.text));
            return text === '' ? [] : [toScriptValue(text)];
        }
        if (ts.isJsxExpression(child)) {
            if (child.expression == undefined) {
                return [];
            }
            if (containsJsx(child.expression)) {
                // checked when the regions were collected, so it is one of the forms
                const form: RegionForm | undefined = resolveForm(child.expression, { diagnostics: [] });
                return form === undefined ? [] : [describeForm(child.expression, form, rows, describing)];
            }
            // html of the server, which the page takes over as it is
            if (describing.opaque.has(child.expression)) {
                return ['{ o: 1 }'];
            }
            return [`{ h: ${getter(printClientNode(child.expression), rows)} }`];
        }
        return [describeMarkup(child, rows, describing)];
    });
}

/**
 * A function computing an expression, with the item and the index of each row it is inside bound to the parameters
 * of the function rendering that row, so it reads the row's current item.
 * @param source - The expression's source.
 * @param rows - The rows it is inside.
 * @returns The function's source.
 */
function getter(source: string, rows: RowScope[]): string {
    return rows.length === 0 ? `() => (${source})` : `() => { ${prelude(rows)}return (${source}); }`;
}

/**
 * Binds the parameters of the functions rendering the rows a description is inside to the item and the index of the
 * current row.
 * @param rows - The rows.
 * @returns The statements.
 */
function prelude(rows: RowScope[]): string {
    // a row inside another one hides a name of the outer row it declares again, as its function does
    const declared: Set<string> = new Set();
    const statements: string[] = [];
    for (const row of [...rows].reverse()) {
        row.parameters.slice(0, 2).forEach((parameter, index) => {
            const names: string[] = collectPatternNames(parameter.name);
            if (names.some(name => declared.has(name))) {
                return;
            }
            names.forEach(name => declared.add(name));
            statements.unshift(`const ${printClientNode(parameter.name)} = ${index === 0 ? `${row.variable}.item` : `${row.variable}.index`}; `);
        });
    }
    return statements.join('');
}
