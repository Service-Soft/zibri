import { ATTRIBUTE_NAME, ATTRIBUTE_NAME_MAP, URL_ATTRIBUTES } from '../../runtime/attribute-rules';
import { toScriptValue } from '../../runtime/script-value';

/**
 * Placeholders inside the client hook sources that {@link substituteHookPlaceholders} replaces with
 * render-time data supplied to `renderPage`.
 */
// eslint-disable-next-line typescript/typedef
export const HOOK_PLACEHOLDERS = {
    /**
     * Replaced with a JSON object of locale -> (source -> translation).
     */
    translations: '__ZIBRI_TRANSLATIONS__',
    /**
     * Replaced with the active locale code string.
     */
    locale: '__ZIBRI_LOCALE__',
    /**
     * Replaced with a JSON object of locale format options (date/time/currency formats).
     */
    formatOptions: '__ZIBRI_LOCALE_FORMAT__'
} as const;

/**
 * What renders the conditions and lists that read state, for a page that uses state. A description of the template's
 * markup is made into a view: its nodes, what writes them again, and what removing them undoes. At the start, a view
 * takes over the nodes the server rendered, walking them in the order of the description, and finds a text by the
 * comments around it. Later, a view is built, or copied from the template the server rendered of a branch or a row
 * holding html only it renders, such as a component. A copy is taken over like what the server rendered, with every
 * value written, as the template holds none. A component inside is a part with a scope of its own, set up when it is
 * taken over and undone when it goes. A condition swaps its branch when it turns, and a list keeps the rows whose key
 * stays.
 */
const REGION_SOURCE: string = `let __zibriParts = {};
let __zibriTemplates = {};
function __zibriTake(cursor) {
    const node = cursor.next;
    cursor.next = node.nextSibling;
    return node;
}
function __zibriView(desc, cursor, templates) {
    const ctx = { updates: [], disposers: [], templates };
    const nodes = __zibriMake(desc, cursor, ctx);
    return {
        nodes,
        disposers: ctx.disposers,
        update() { for (const update of ctx.updates) { try { update(); } catch (error) { reportError(error); } } },
        dispose() { for (const dispose of ctx.disposers.splice(0)) { try { dispose(); } catch (error) { reportError(error); } } }
    };
}
function __zibriRemove(view) {
    view.dispose();
    const last = view.nodes[view.nodes.length - 1];
    let node = view.nodes[0];
    while (node) {
        const next = node.nextSibling;
        node.remove();
        if (node === last) { return; }
        node = next;
    }
}
let __zibriTemplateTags;
function __zibriTemplateOf(id) {
    if (__zibriTemplateTags === undefined) {
        __zibriTemplateTags = new Map();
        for (const tag of document.querySelectorAll('template[data-zt]')) { __zibriTemplateTags.set(tag.getAttribute('data-zt'), tag); }
    }
    return __zibriTemplateTags.get(id);
}
function __zibriBuild(desc, form, slot, templates) {
    const id = templates && templates[form] ? templates[form][slot] : undefined;
    const template = id === undefined ? undefined : __zibriTemplateOf(id);
    if (template === undefined) { return __zibriView(desc, undefined, templates); }
    const fragment = template.content.cloneNode(true);
    const scope = __zibriScope(__zibriCurrent, true);
    __zibriCollect(scope, [...fragment.childNodes]);
    const view = __zibriIn(scope, () => {
        const made = __zibriView(desc, { next: fragment.firstChild, fresh: true }, templates);
        const record = __zibriTemplates[id];
        if (record !== undefined) { __zibriRunSetup(record); }
        // the children a component above handed, which the copy places again
        for (const comment of scope.placements) {
            const adopter = comment.__zibriAdopted ? undefined : __zibriFind(scope, 'adopters', comment.data.slice(1));
            if (adopter !== undefined) { adopter(comment, made.disposers, true); }
        }
        return made;
    });
    view.disposers.push(() => __zibriDispose(scope));
    __zibriFlush();
    return view;
}
function __zibriMake(desc, cursor, ctx) {
    if (typeof desc === 'string') { return [cursor ? __zibriTake(cursor) : document.createTextNode(desc)]; }
    if (desc.f) { return desc.f.flatMap(child => __zibriMake(child, cursor, ctx)); }
    if (desc.t) { return [__zibriElement(desc, cursor, ctx)]; }
    if (desc.q) { return __zibriPart(desc, cursor, ctx); }
    if (desc.o) { return cursor ? __zibriSpan(cursor) : []; }
    const start = cursor ? __zibriTake(cursor) : document.createComment('[');
    if (desc.h) { return __zibriHole(desc, start, cursor, ctx); }
    // a template holds no branch and no rows, which the page builds into the copy
    const adopt = cursor && !cursor.fresh ? cursor : undefined;
    const range = desc.k === 'if' ? __zibriIf(desc, adopt, ctx.templates) : __zibriList(desc, adopt, ctx.templates);
    const end = cursor ? __zibriTake(cursor) : document.createComment(']');
    if (cursor && cursor.fresh) { end.before(...range.nodes()); }
    ctx.updates.push(() => range.update(end));
    ctx.disposers.push(() => range.dispose());
    return [start, ...range.nodes(), end];
}
function __zibriSpan(cursor) {
    const nodes = [__zibriTake(cursor)];
    let depth = 0;
    while (cursor.next) {
        const node = __zibriTake(cursor);
        nodes.push(node);
        if (node.nodeType !== Node.COMMENT_NODE) { continue; }
        if (node.data[0] === '{') { depth++; }
        else if (node.data === '}') {
            if (depth === 0) { break; }
            depth--;
        }
    }
    return nodes;
}
function __zibriPartValues(props) {
    const values = {};
    const kinds = {};
    for (const name of Object.keys(props)) {
        const [kind, get] = props[name];
        kinds[name] = kind;
        if (kind === 'f') {
            values[name] = (...args) => {
                const run = get();
                return typeof run === 'function' ? run(...args) : undefined;
            };
        }
        else if (kind === 's') { values[name] = { get value() { return get().value; }, set value(next) { get().value = next; } }; }
        else { values[name] = __zibriDerived(get); }
    }
    return { values, kinds };
}
function __zibriPart(desc, cursor, ctx) {
    if (!cursor) { return []; }
    const nodes = __zibriSpan(cursor);
    const id = nodes[0].data.slice(1);
    const scope = __zibriScope(__zibriCurrent, cursor.fresh);
    scope.parts.set(id, __zibriPartValues(desc.q));
    __zibriCollect(scope, nodes.slice(1, -1));
    // the children the component is handed, wherever it places them: now, and again whenever it shows them again
    if (desc.ch) {
        const live = new Set();
        scope.adopters.set(id, (comment, disposers, fresh) => {
            comment.__zibriAdopted = true;
            const sub = { updates: [], disposers: [], templates: ctx.templates };
            const at = { next: comment.nextSibling, fresh };
            for (const child of desc.ch) { __zibriMake(child, at, sub); }
            const update = () => { for (const step of sub.updates) { try { step(); } catch (error) { reportError(error); } } };
            live.add(update);
            disposers.push(() => {
                live.delete(update);
                for (const dispose of sub.disposers) { try { dispose(); } catch (error) { reportError(error); } }
            });
        });
        ctx.updates.push(() => { for (const update of live) { update(); } });
        for (const comment of scope.placements) {
            if (comment.data === '(' + id && !comment.__zibriAdopted) { scope.adopters.get(id)(comment, ctx.disposers, cursor.fresh); }
        }
    }
    __zibriIn(scope, () => {
        const record = __zibriParts[id];
        if (record !== undefined) { __zibriRunSetup(record); }
    });
    ctx.disposers.push(() => __zibriDispose(scope));
    __zibriFlush();
    return nodes;
}
function __zibriPartValue(id, prop) {
    const part = __zibriFind(__zibriCurrent, 'parts', id);
    return part === undefined ? undefined : part.values[prop];
}
function __zibriPartEntries(data) {
    for (const entry of data.bindings) {
        const part = __zibriFind(__zibriCurrent, 'parts', entry.part);
        if (part === undefined) { continue; }
        const handle = part.values[entry.prop];
        __zibriBind(entry.id, entry.kind, entry.attribute, () => handle.value);
        if (part.kinds[entry.prop] === 's' && (entry.attribute === 'value' || entry.attribute === 'checked')) {
            __zibriWriteBack(entry.id, entry.attribute, next => { handle.value = next; });
        }
    }
    for (const entry of data.handlers) {
        const part = __zibriFind(__zibriCurrent, 'parts', entry.part);
        if (part === undefined) { continue; }
        const run = part.values[entry.prop];
        for (const stamp of __zibriCurrent.stamps.get(entry.id) || []) { stamp.element.addEventListener(entry.event, event => run(event)); }
    }
}
function __zibriHole(desc, start, cursor, ctx) {
    let last = __zibriUnset;
    try { last = desc.h(); } catch (error) { reportError(error); }
    let text;
    if (cursor && !cursor.fresh) {
        if (cursor.next && cursor.next.nodeType === Node.TEXT_NODE) { text = __zibriTake(cursor); }
    }
    else {
        text = document.createTextNode(__zibriText(last));
        if (cursor) { start.after(text); }
    }
    const end = cursor ? __zibriTake(cursor) : document.createComment(']');
    ctx.updates.push(() => {
        const next = desc.h();
        if (Object.is(next, last)) { return; }
        last = next;
        if (!text) { text = document.createTextNode(''); start.after(text); }
        text.data = __zibriText(next);
    });
    return text ? [start, text, end] : [start, end];
}
function __zibriElement(desc, cursor, ctx) {
    const element = cursor ? __zibriTake(cursor) : document.createElement(desc.t);
    // what the server rendered holds the values, and a copy of a template none
    const adopt = cursor && !cursor.fresh;
    for (const [name, get] of desc.a) {
        let last = __zibriUnset;
        const write = () => {
            const next = get();
            if (Object.is(next, last)) { return; }
            last = next;
            __zibriAttribute(element, name, next);
        };
        if (adopt) { try { last = get(); } catch (error) { reportError(error); } }
        else { try { write(); } catch (error) { reportError(error); } }
        ctx.updates.push(write);
    }
    for (const get of desc.s) {
        let last = {};
        const write = () => {
            const next = get() || {};
            for (const name of Object.keys(last)) { if (!(name in next)) { __zibriAttribute(element, name, undefined); } }
            for (const [name, value] of Object.entries(next)) {
                if (!Object.is(value, last[name])) { __zibriAttribute(element, name, value); }
            }
            last = { ...next };
        };
        if (adopt) { try { last = { ...(get() || {}) }; } catch (error) { reportError(error); } }
        else { try { write(); } catch (error) { reportError(error); } }
        ctx.updates.push(write);
    }
    for (const [event, get] of desc.on) {
        element.addEventListener(event, (ev) => { const handler = get(); if (typeof handler === 'function') { handler(ev); } });
    }
    for (const [name, get] of desc.w) {
        element.addEventListener(name === 'checked' ? 'change' : 'input', () => { get().value = element[name]; });
    }
    // an element of the server, or of a copy, is stamped with its ref
    if (desc.r && !cursor) { __zibriRefAdd(desc.r(), element); }
    const inner = cursor ? { next: element.firstChild, fresh: cursor.fresh } : undefined;
    for (const child of desc.c) {
        const made = __zibriMake(child, inner, ctx);
        if (!cursor) { element.append(...made); }
    }
    return element;
}
function __zibriIf(desc, cursor, templates) {
    let holds = false;
    try { holds = Boolean(desc.c()); } catch (error) { reportError(error); }
    const make = (adopt) => {
        const branch = holds ? desc.y : desc.n;
        if (!branch) { return undefined; }
        return adopt ? __zibriView(branch, adopt, templates) : __zibriBuild(branch, desc.id, holds ? 'y' : 'n', templates);
    };
    let view = make(cursor);
    return {
        nodes: () => view ? view.nodes : [],
        update(end) {
            const next = Boolean(desc.c());
            if (next === holds) {
                if (view) { view.update(); }
                return;
            }
            holds = next;
            if (view) { __zibriRemove(view); }
            view = make(undefined);
            if (view) { end.before(...view.nodes); }
        },
        dispose() { if (view) { view.dispose(); } }
    };
}
function __zibriList(desc, cursor, templates) {
    let items = [];
    try { items = Array.from(desc.l() || []); } catch (error) { reportError(error); }
    const make = (row, adopt) => adopt
        ? __zibriView(desc.row(row), adopt, templates)
        : __zibriBuild(desc.row(row), desc.id, 'row', templates);
    let rows = items.map((item, index) => {
        const row = { item, index };
        row.key = desc.key(row);
        row.view = make(row, cursor);
        return row;
    });
    return {
        nodes: () => rows.flatMap(row => row.view.nodes),
        dispose() { for (const row of rows) { row.view.dispose(); } },
        update(end) {
            const items = Array.from(desc.l() || []);
            const keys = items.map((item, index) => desc.key({ item, index }));
            const seen = new Set();
            for (const key of keys) {
                if (seen.has(key)) {
                    throw new Error('Two rows of a list have the key \\'' + String(key) + '\\', and the list keeps the rows it has.'
                        + ' Give each row a key of its own.');
                }
                seen.add(key);
            }
            const byKey = new Map();
            for (const row of rows) { if (!byKey.has(row.key)) { byKey.set(row.key, row); } }
            const kept = new Set();
            const next = items.map((item, index) => {
                let row = byKey.get(keys[index]);
                if (row !== undefined) {
                    kept.add(row);
                    row.item = item;
                    row.index = index;
                    row.view.update();
                    return row;
                }
                row = { item, index, key: keys[index] };
                row.view = make(row);
                return row;
            });
            for (const row of rows) { if (!kept.has(row)) { __zibriRemove(row.view); } }
            // moving the element holding the focus takes it away, so it is given back with its selection
            const focused = document.activeElement;
            const selection = focused && typeof focused.selectionStart === 'number'
                ? [focused.selectionStart, focused.selectionEnd]
                : undefined;
            let place = end;
            for (let index = next.length - 1; index >= 0; index--) {
                const nodes = next[index].view.nodes;
                if (nodes[nodes.length - 1].nextSibling !== place) { place.before(...nodes); }
                place = nodes[0];
            }
            if (focused && focused !== document.activeElement && focused.isConnected) {
                focused.focus();
                if (selection) { focused.setSelectionRange(selection[0], selection[1]); }
            }
            rows = next;
        }
    };
}
function __zibriRegion(id, desc, templates) {
    const scope = __zibriCurrent;
    const start = __zibriMarkerOf(scope, id);
    const end = __zibriMarkerOf(scope, '/' + id);
    if (start === undefined || end === undefined) { return; }
    let range;
    // ahead of the bindings of the components inside, so they read the items of the rows this update hands them
    __zibriAddBinding(() => { if (range) { __zibriIn(scope, () => range.update(end)); } });
    // a copy of a template holds none of it, and it is built into the copy
    const cursor = scope.fresh ? undefined : { next: start.nextSibling };
    range = desc.k === 'if' ? __zibriIf(desc, cursor, templates) : __zibriList(desc, cursor, templates);
    if (scope.fresh) { end.before(...range.nodes()); }
    scope.undo.push(() => range.dispose());
}`;

/**
 * The scopes of a page: the page itself, and each part of markup the browser renders again, such as a component in a
 * row, and each copy of a template. A scope holds the elements and comments it finds its own by, the instances set up in
 * it, the props of its part, the children it places, and what removing it undoes. Setup code finds what it reads in
 * the scope it runs in and those above, as the ids in each copy of a template are the same.
 */
const SCOPE_SOURCE: string = `function __zibriScope(parent, fresh) {
    return {
        parent, fresh, stamps: new Map(), markers: new Map(), instances: new Map(), parts: new Map(), adopters: new Map(),
        placements: [], lifted: [], undo: []
    };
}
const __zibriPage = {
    parent: undefined, fresh: false, stamps: __zibriStamps, markers: undefined, instances: new Map(), parts: new Map(),
    adopters: new Map(), placements: [], lifted: [], undo: []
};
let __zibriCurrent = __zibriPage;
function __zibriIn(scope, run) {
    const outer = __zibriCurrent;
    __zibriCurrent = scope;
    try { return run(); } finally { __zibriCurrent = outer; }
}
function __zibriFind(scope, key, name) {
    for (let found = scope; found !== undefined; found = found.parent) {
        if (found[key].has(name)) { return found[key].get(name); }
    }
    return undefined;
}
function __zibriOwn(owner, attach, values) { __zibriCurrent.instances.set(owner, { attach, values: values || {} }); }
function __zibriAttachTo(owner, data) {
    const instance = __zibriFind(__zibriCurrent, 'instances', owner);
    if (instance !== undefined) { instance.attach(data); }
}
function __zibriProp(owner, id) {
    const instance = __zibriFind(__zibriCurrent, 'instances', owner);
    return instance === undefined ? undefined : instance.values[id];
}
function __zibriStampIn(stamps, id, element, event) {
    const list = stamps.get(id) || [];
    stamps.set(id, list);
    if (list.some(stamp => stamp.element === element)) { return false; }
    list.push({ element, event });
    return true;
}
function __zibriCollect(scope, nodes) {
    for (const node of nodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            for (const element of [node, ...node.querySelectorAll('[data-ssr]')]) {
                for (const entry of (element.getAttribute('data-ssr') || '').split('|')) {
                    if (entry === '') { continue; }
                    const [id, event] = entry.split(':');
                    __zibriStampIn(scope.stamps, id, element, event);
                    // and in the scopes above, where a ref of an instance outside finds it; the pass over the document
                    // found what the server rendered
                    for (let above = scope.parent; above !== undefined && (scope.fresh || above !== __zibriPage); above = above.parent) {
                        if (__zibriStampIn(above.stamps, id, element, event)) { scope.lifted.push([above.stamps, id, element]); }
                    }
                }
            }
        }
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_COMMENT);
        for (let comment = node.nodeType === Node.COMMENT_NODE ? node : walker.nextNode(); comment !== null; comment = walker.nextNode()) {
            if (comment.data[0] === '(') { scope.placements.push(comment); }
            else if (!scope.markers.has(comment.data)) { scope.markers.set(comment.data, comment); }
        }
    }
}
function __zibriDispose(scope) {
    for (const step of scope.undo.splice(0)) { try { step(); } catch (error) { reportError(error); } }
    for (const [stamps, id, element] of scope.lifted.splice(0)) {
        stamps.set(id, (stamps.get(id) || []).filter(stamp => stamp.element !== element));
    }
}`;

/**
 * The first line of a hook that keeps the scope it was called in, for what it runs later.
 */
const KEEP_CURRENT_SCOPE: string = '    const scope = __zibriCurrent;';

/**
 * Client-side, dependency-free source of the framework hooks the client script may reference.
 * The `$t`/`$ts` translation tables and `$f` format options are placeholders filled per render.
 */
export const CLIENT_HOOK_SOURCES: Readonly<Record<string, string>> = {
    // One for the page, with the start every client script has: each setup runs through
    // `__zibriRunSetup`, and `__zibriStart` runs the callbacks once all of them are done. A callback of
    // one component could otherwise read a `const` its setup had not declared yet, find its own handlers
    // not attached, and a throw would cost every later component its setup.
    onClient: [
        // one pass over the document for the whole page: every stamped element, by the id of each entry of
        // its stamp, so a setup finds its own elements without looking through the document again
        'const __zibriStamps = new Map();',
        'for (const element of document.querySelectorAll(\'[data-ssr]\')) {',
        '    for (const entry of (element.getAttribute(\'data-ssr\') || \'\').split(\'|\')) {',
        '        const [id, event] = entry.split(\':\');',
        '        if (!__zibriStamps.has(id)) { __zibriStamps.set(id, []); }',
        '        __zibriStamps.get(id).push({ element, event });',
        '    }',
        '}',
        SCOPE_SOURCE,
        // the handle of a ref, reading the elements of its scope that are still in the document, those of copies of
        // templates in it, and those the page rendered later, in the order of the document
        'function __zibriRef(entry) {',
        KEEP_CURRENT_SCOPE,
        '    const elements = () => (scope.stamps.get(entry.id) || []).map(stamp => stamp.element).filter(element => element.isConnected)',
        '        .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);',
        '    return entry.many ? { entry, scope, get current() { return elements(); } } : { entry, scope, get current() {',
        '        const element = elements()[0];',
        '        if (element === undefined && entry.required) {',
        '            throw new Error(\'The ref \\\'\' + entry.name + \'\\\' of \\\'\' + entry.component',
        '                + \'\\\' is on no element in the page.\');',
        '        }',
        '        return element;',
        '    } };',
        '}',
        // an element a condition or a list rendered later, put among the elements of its ref
        'function __zibriRefAdd(handle, element) {',
        '    if (!handle || !handle.entry || !handle.scope) { return; }',
        '    __zibriStampIn(handle.scope.stamps, handle.entry.id, element, undefined);',
        '}',
        'const __zibriStartup = { queue: [], pending: undefined, started: false, running: false };',
        'const onClient = (callback) => {',
        // in the scope it was called in, and what it returns runs when that is removed
        KEEP_CURRENT_SCOPE,
        '    const run = () => __zibriIn(scope, () => {',
        '        const cleanup = callback();',
        '        if (typeof cleanup === \'function\') { scope.undo.push(cleanup); }',
        '    });',
        // during a setup: kept with that setup, and dropped if it throws
        '    if (__zibriStartup.pending) { __zibriStartup.pending.push(run); return; }',
        // before the start, or from a callback: joins the run, after the ones already waiting
        '    if (__zibriStartup.running || !__zibriStartup.started) { __zibriStartup.queue.push(run); return; }',
        '    try { run(); } catch (error) { reportError(error); }',
        '};',
        'function __zibriRunSetup(setup) {',
        '    const outer = __zibriStartup.pending;',
        '    const pending = [];',
        '    __zibriStartup.pending = pending;',
        '    try {',
        '        const result = setup();',
        // a setup inside another, such as of a component the markup of a setup takes over, queues behind it
        '        (outer || __zibriStartup.queue).push(...pending);',
        '        return result;',
        '    }',
        '    catch (error) { reportError(error); return undefined; }',
        '    finally { __zibriStartup.pending = outer; }',
        '}',
        'function __zibriDrain() {',
        '    __zibriStartup.running = true;',
        '    for (let i = 0; i < __zibriStartup.queue.length; i++) {',
        '        try { __zibriStartup.queue[i](); } catch (error) { reportError(error); }',
        '    }',
        '    __zibriStartup.queue.length = 0;',
        '    __zibriStartup.running = false;',
        '}',
        'function __zibriStart() {',
        '    __zibriStartup.started = true;',
        '    __zibriDrain();',
        '}',
        // the callbacks of setups that ran after the start, such as of a component a list builds
        'function __zibriFlush() {',
        '    if (__zibriStartup.started && !__zibriStartup.running && __zibriStartup.pending === undefined) { __zibriDrain(); }',
        '}'
    ].join('\n'),
    onServer: 'const onServer = () => {};',
    // what keeps state, for a page that uses it: a write that changes the value schedules one run of every
    // binding of the page, after the code writing has finished, so several writes are written to the page once
    useState: [
        'const __zibriBindings = new Set();',
        'const __zibriEffects = new Set();',
        'let __zibriScheduled = false;',
        'function __zibriUpdate() {',
        '    __zibriScheduled = false;',
        '    for (const binding of __zibriBindings) {',
        '        try { binding(); } catch (error) { reportError(error); }',
        '    }',
        // after the bindings, so an effect reading the page finds it written
        '    for (const effect of __zibriEffects) { effect(); }',
        '}',
        // a binding of the scope it is made in, which removing the scope drops
        'function __zibriAddBinding(binding) {',
        '    __zibriBindings.add(binding);',
        '    __zibriCurrent.undo.push(() => __zibriBindings.delete(binding));',
        '}',
        'function __zibriState(states, name) {',
        '    let current = states[name];',
        '    return {',
        '        get value() { return current; },',
        '        set value(next) {',
        '            if (Object.is(current, next)) { return; }',
        '            current = next;',
        '            if (!__zibriScheduled) { __zibriScheduled = true; queueMicrotask(__zibriUpdate); }',
        '        }',
        '    };',
        '}',
        // what a component reads with useInput: a value a component above derived from a state, computed when read
        'function __zibriDerived(compute) {',
        '    return {',
        '        get value() { return compute(); },',
        '        set value(next) { throw new Error(\'A value a component is handed is read only.\'); }',
        '    };',
        '}',
        // the handle useInput and useWritableInput return: the one the component handing it built, or the value it
        // was handed, which follows no state
        'function __zibriInput(data, name) {',
        '    if (data.inputs !== undefined && name in data.inputs && data.inputs[name] !== undefined) { return data.inputs[name]; }',
        '    const value = data.states[name];',
        '    return __zibriDerived(() => value);',
        '}',
        // the rules attr() writes an attribute by on the server, so the page writes it the same way
        `const __zibriUrlAttributes = new Set(${JSON.stringify([...URL_ATTRIBUTES])});`,
        `const __zibriAttributeName = new RegExp(${JSON.stringify(ATTRIBUTE_NAME.source)});`,
        `const __zibriAttributeNames = ${JSON.stringify(ATTRIBUTE_NAME_MAP)};`,
        'function __zibriText(value) {',
        '    if (value == null || typeof value === \'boolean\') { return \'\'; }',
        '    if (Array.isArray(value)) { return value.map(__zibriText).join(\'\'); }',
        '    return typeof value === \'string\' || typeof value === \'number\' || typeof value === \'bigint\' ? String(value) : \'\';',
        '}',
        'function __zibriIsScriptUrl(url) {',
        '    const scheme = [...url].filter(character => character > \' \').join(\'\').toLowerCase();',
        '    return scheme.startsWith(\'javascript:\') || scheme.startsWith(\'vbscript:\');',
        '}',
        'function __zibriAttribute(element, name, value) {',
        '    if (name.toLowerCase().startsWith(\'on\') || !__zibriAttributeName.test(name)) { return; }',
        '    const mapped = __zibriAttributeNames[name] || name;',
        // what a user changes is the property, which the attribute no longer decides once they did
        '    if (name === \'checked\' || name === \'selected\') { element[name] = !(value == null || value === false); return; }',
        // only when it differs, as writing the text a user is typing again moves the cursor to its end
        '    if (name === \'value\') {',
        '        const text = value == null || typeof value === \'boolean\' ? \'\' : String(value);',
        '        if (element.value !== text) { element.value = text; }',
        '        return;',
        '    }',
        // properties of the element's style, which a page's policy allows where it refuses a style attribute
        '    if (name === \'style\') {',
        '        element.style.cssText = \'\';',
        '        if (typeof value === \'string\') { element.style.cssText = value; }',
        '        else if (typeof value === \'object\' && value !== null) {',
        '            for (const [key, entry] of Object.entries(value)) {',
        '                if (entry == null || entry === false) { continue; }',
        '                element.style.setProperty(',
        '                    key.startsWith(\'--\') ? key : key.replace(/[A-Z]/g, letter => \'-\' + letter.toLowerCase()),',
        '                    String(entry)',
        '                );',
        '            }',
        '        }',
        '        return;',
        '    }',
        '    if (value == null || value === false || typeof value === \'function\') { element.removeAttribute(mapped); return; }',
        '    if (value === true) { element.setAttribute(mapped, \'\'); return; }',
        '    const text = typeof value === \'symbol\' ? value.toString() : typeof value === \'object\' ? \'\' : String(value);',
        '    if (__zibriUrlAttributes.has(mapped.toLowerCase()) && __zibriIsScriptUrl(text)) { element.removeAttribute(mapped); return; }',
        '    element.setAttribute(mapped, text);',
        '}',
        // the comments around each text hole, found in one walk over the document when a text is first written
        'let __zibriMarkers;',
        'function __zibriMarker(id) {',
        '    if (__zibriMarkers === undefined) {',
        '        __zibriMarkers = new Map();',
        '        const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_COMMENT);',
        '        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) { __zibriMarkers.set(node.data, node); }',
        '    }',
        '    return __zibriMarkers.get(id);',
        '}',
        // the page's comments, or those of a part or a copy
        'function __zibriMarkerOf(scope, id) {',
        '    return scope.markers === undefined ? __zibriMarker(id) : scope.markers.get(id);',
        '}',
        'function __zibriWriteText(scope, id, text) {',
        '    const start = __zibriMarkerOf(scope, id);',
        '    const end = __zibriMarkerOf(scope, \'/\' + id);',
        '    if (start === undefined || end === undefined) { return; }',
        '    const only = start.nextSibling;',
        '    if (only !== null && only.nodeType === Node.TEXT_NODE && only.nextSibling === end) {',
        '        if (only.data !== text) { only.data = text; }',
        '        return;',
        '    }',
        '    while (start.nextSibling !== null && start.nextSibling !== end) { start.nextSibling.remove(); }',
        '    start.after(document.createTextNode(text));',
        '}',
        // a state itself on a control: what the user enters is written back, `input` for a value and `change` for checked
        'function __zibriWriteBack(id, attribute, write) {',
        '    for (const stamp of __zibriCurrent.stamps.get(id) || []) {',
        '        const event = attribute === \'checked\' ? \'change\' : \'input\';',
        '        stamp.element.addEventListener(event, () => write(stamp.element[attribute]));',
        '    }',
        '}',
        // a binding is computed once now, as the server already wrote what it is, and written again when it changes. A
        // copy of a template holds none of it, so there it is written now
        'const __zibriUnset = {};',
        'function __zibriBind(id, kind, attribute, compute) {',
        KEEP_CURRENT_SCOPE,
        '    let last = __zibriUnset;',
        '    const write = () => {',
        '        const next = compute();',
        '        if (Object.is(next, last)) { return; }',
        '        last = next;',
        '        if (kind === \'text\') { __zibriWriteText(scope, id, __zibriText(next)); return; }',
        '        for (const stamp of scope.stamps.get(id) || []) {',
        '            if (kind === \'content\') { stamp.element.textContent = __zibriText(next); }',
        '            else { __zibriAttribute(stamp.element, attribute, next); }',
        '        }',
        '    };',
        '    if (scope.fresh) { try { write(); } catch (error) { reportError(error); } }',
        '    else { try { last = compute(); } catch (error) { reportError(error); } }',
        '    __zibriAddBinding(write);',
        '}',
        REGION_SOURCE
    ].join('\n'),
    // an effect first runs in the queue of onClient, and then from each update in which what its list reads changed:
    // the value of a state, or what a function returns
    useEffect: [
        'const useEffect = (run, watched) => {',
        '    let seen;',
        '    let cleanup;',
        '    const undo = () => {',
        '        if (typeof cleanup !== \'function\') { return; }',
        '        const previous = cleanup;',
        '        cleanup = undefined;',
        '        try { previous(); } catch (error) { reportError(error); }',
        '    };',
        '    const update = () => {',
        '        let next;',
        '        try { next = watched.map(entry => typeof entry === \'function\' ? entry() : entry.value); }',
        '        catch (error) { reportError(error); return; }',
        '        if (seen !== undefined && next.every((value, index) => Object.is(value, seen[index]))) { return; }',
        '        seen = next;',
        '        undo();',
        '        try { cleanup = run(); } catch (error) { reportError(error); }',
        '    };',
        // removing the scope it runs in stops it, and runs its cleanup
        '    onClient(() => {',
        '        __zibriEffects.add(update);',
        '        __zibriCurrent.undo.push(() => { __zibriEffects.delete(update); undo(); });',
        '        update();',
        '    });',
        '};'
    ].join('\n'),
    $t: [
        'const $t = (strings, ...values) => {',
        '    const params = {}; let source = \'\';',
        '    for (let i = 0; i < strings.length; i++) {',
        '        source += strings[i].replaceAll(\'{\', \'{{\').replaceAll(\'}\', \'}}\');',
        '        if (i < values.length) {',
        '            const value = values[i]; let key;',
        '            if (value !== null && typeof value === \'object\' && !Array.isArray(value) && Object.keys(value).length === 1) {',
        '                const entry = Object.entries(value)[0]; key = entry[0]; params[key] = entry[1];',
        '            } else { key = \'$\' + (i + 1); params[key] = value; }',
        '            source += \'{\' + key + \'}\';',
        '        }',
        '    }',
        `    const translations = ${HOOK_PLACEHOLDERS.translations};`,
        '    return { source, params, getValue: (locale) => {',
        // Locale resolution mirrors zibri's $t: exact, then two-part, then language, then any
        // variant of the language.
        '        let resolvedLocale;',
        '        const available = Object.keys(translations);',
        '        if (available.includes(locale)) { resolvedLocale = locale; }',
        '        else {',
        '            const parts = locale.split(\'-\');',
        '            const language = parts[0]; const second = parts[1]; const third = parts[2];',
        '            if (third) {',
        '                const twoPartLocale = language + \'-\' + second;',
        '                if (available.includes(twoPartLocale)) { resolvedLocale = twoPartLocale; }',
        '            }',
        '            if (available.includes(language)) { resolvedLocale ??= language; }',
        '            resolvedLocale ??= available.find((l) => l.startsWith(language + \'-\'));',
        '        }',
        '        const res = resolvedLocale ? (translations[resolvedLocale]?.[source] ?? source) : source;',
        // eslint-disable-next-line stylistic/max-len
        '        return res.replaceAll(/{{|}}|{([^}]+)}/g, (match, name) => match === \'{{\' ? \'{\' : match === \'}}\' ? \'}\' : (name != undefined && name in params ? String(params[name]) : match));',
        '    } };',
        '};'
    ].join('\n'),
    $ts: [`const $ts = (strings, ...values) => $t(strings, ...values).getValue(${HOOK_PLACEHOLDERS.locale});`].join('\n'),
    $f: [
        'const $f = (function () {',
        `    const opts = ${HOOK_PLACEHOLDERS.formatOptions};`,
        '    const pad = (n) => String(n).padStart(2, \'0\');',
        '    const fmt = (d, f) => {',
        '        const h = d.getHours(); const h12 = h % 12 || 12;',
        '        return f.replace(/YYYY|YY|MM|DD|HH|hh|h|mm|ss|A|a/g, (t) => ({',
        '            YYYY: d.getFullYear(), YY: String(d.getFullYear()).slice(-2),',
        '            MM: pad(d.getMonth() + 1), DD: pad(d.getDate()),',
        '            HH: pad(h), hh: pad(h12), h: h12,',
        '            mm: pad(d.getMinutes()), ss: pad(d.getSeconds()),',
        '            A: h < 12 ? \'AM\' : \'PM\', a: h < 12 ? \'am\' : \'pm\'',
        '        })[t] ?? t);',
        '    };',
        '    return {',
        '        date: (d) => fmt(new Date(d), opts.dateFormat),',
        '        time: (d) => fmt(new Date(d), opts.timeFormat),',
        '        dateTime: (d) => fmt(new Date(d), opts.dateTimeFormat),',
        '        price: (a, c) => Number(a).toLocaleString(opts.locale, { style: \'currency\', currency: c || opts.currencyCode }),',
        '        percent: (v) => v.toLocaleString(opts.locale, { style: \'percent\' })',
        '    };',
        '})();'
    ].join('\n')
};

/**
 * What the start of the page defines for the setups to read, besides the hooks: the elements its one pass
 * over the document found. A setup reads it, and client code a template writes may not.
 */
export const PAGE_RUNTIME_NAMES: readonly string[] = [
    '__zibriStamps',
    '__zibriCurrent',
    '__zibriOwn',
    '__zibriRef',
    '__zibriState',
    '__zibriBind',
    '__zibriDerived',
    '__zibriInput',
    '__zibriWriteBack',
    '__zibriRegion'
];

/**
 * Render-time data used to fill the hook placeholders.
 */
export type HookData = {
    /**
     * Translations by locale then source string.
     */
    translations: unknown,
    /**
     * The active locale code.
     */
    locale: string,
    /**
     * The locale format options for `$f`.
     */
    formatOptions: unknown
};

/**
 * Substitutes the hook placeholders in a hook source with JSON-serialized render-time data.
 * @param source - The hook source containing placeholders.
 * @param data - The render-time data.
 * @returns The source with placeholders replaced.
 */
export function substituteHookPlaceholders(source: string, data: HookData): string {
    // Function replacers are required: the serialized data can contain `$$`, `$&` and friends,
    // which a string replacement would interpret as substitution patterns.
    return source
        .replaceAll(HOOK_PLACEHOLDERS.translations, () => toScriptValue(data.translations))
        .replaceAll(HOOK_PLACEHOLDERS.locale, () => toScriptValue(data.locale))
        .replaceAll(HOOK_PLACEHOLDERS.formatOptions, () => toScriptValue(data.formatOptions));
}