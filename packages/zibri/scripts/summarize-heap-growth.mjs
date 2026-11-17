/* eslint-disable jsdoc/require-jsdoc */
import { createReadStream } from 'node:fs';

// what a process came to hold between two heap snapshots of it, and what holds it: every object of
// the second snapshot that the first has not got (v8 keeps an object's id across snapshots), summed up
// by what it is, and by the object of the first snapshot it hangs from. The way to find what a phase
// of a benchmark holds on to, such as what ZIBRI_BENCHMARK_HEAP_SNAPSHOT=1 writes for a backup.
// Usage: node scripts/summarize-heap-growth.mjs <before.heapsnapshot> <after.heapsnapshot> [how many rows, 15 by default] [a group]
// With a group, as the summary names one under "by the variable or property holding them", it lists
// every way the objects of that group are held instead.
//
// Read as a stream rather than with JSON.parse: the snapshot of a process holding a few hundred MiB is
// longer than the longest string v8 can make.

const MIB = 1024 * 1024;

// a list of numbers that grows as it is read, held outside the heap
class NumberList {
    constructor() {
        this.values = new Uint32Array(1 << 20);
        this.length = 0;
    }

    push(value) {
        if (this.length === this.values.length) {
            const grown = new Uint32Array(this.values.length * 2);
            grown.set(this.values);
            this.values = grown;
        }
        this.values[this.length++] = value;
    }
}

// reads a snapshot: its meta, its nodes and edges, and its strings. With idsOnly, only the id of each
// node, which is all the first snapshot is needed for
async function readHeapSnapshot(file, { idsOnly = false } = {}) {
    let head = '';
    let meta;
    let mode = 'head';
    let key = '';
    let keyBuffer = '';
    let number = 0;
    let inNumber = false;
    let rawString = '';
    let inString = false;
    let escaped = false;
    let fieldCount = 0;
    let idField = 0;
    let field = 0;
    const nodes = new NumberList();
    const edges = new NumberList();
    const ids = new Set();
    const strings = [];

    const pushNumber = value => {
        if (key === 'nodes') {
            if (idsOnly) {
                if (field === idField) {
                    ids.add(value);
                }
                field = (field + 1) % fieldCount;
                return;
            }
            nodes.push(value);
        }
        else if (key === 'edges' && !idsOnly) {
            edges.push(value);
        }
    };

    for await (const chunk of createReadStream(file, { encoding: 'utf8', highWaterMark: MIB })) {
        let i = 0;
        if (mode === 'head') {
            head += chunk;
            const start = head.indexOf('"nodes":[');
            if (start === -1) {
                continue;
            }
            meta = JSON.parse(`${head.slice(0, start).trim()
                .replace(/,$/, '')}}`).snapshot.meta;
            fieldCount = meta.node_fields.length;
            idField = meta.node_fields.indexOf('id');
            // what of the chunk follows the bracket
            i = chunk.length - (head.length - start - '"nodes":['.length);
            mode = 'numbers';
            key = 'nodes';
        }
        for (; i < chunk.length; i++) {
            const code = chunk.charCodeAt(i);
            switch (mode) {
                case 'numbers': {
                    if (code >= 48 && code <= 57) {
                        number = (number * 10) + (code - 48);
                        inNumber = true;
                        break;
                    }
                    if (inNumber) {
                        pushNumber(number);
                        number = 0;
                        inNumber = false;
                    }
                    if (code === 93) {
                        mode = 'key';
                        keyBuffer = '';
                    }
                    break;
                }
                case 'key': {
                    keyBuffer += chunk[i];
                    const match = /"([a-z_]+)":\s*\[$/.exec(keyBuffer);
                    if (match != undefined) {
                        key = match[1];
                        mode = key === 'strings' ? 'strings' : 'numbers';
                    }
                    break;
                }
                case 'strings': {
                    if (inString) {
                        rawString += chunk[i];
                        if (escaped) {
                            escaped = false;
                        }
                        else if (code === 92) {
                            escaped = true;
                        }
                        else if (code === 34) {
                            inString = false;
                            if (!idsOnly) {
                                strings.push(JSON.parse(rawString));
                            }
                        }
                        break;
                    }
                    if (code === 34) {
                        inString = true;
                        rawString = '"';
                    }
                    else if (code === 93) {
                        mode = 'done';
                    }
                    break;
                }
                default: {
                    break;
                }
            }
        }
    }
    return { meta, nodes: nodes.values.subarray(0, nodes.length), edges: edges.values.subarray(0, edges.length), ids, strings };
}

// what the objects of the second snapshot that the first has not got are, and what holds them
function resolveHeapGrowth(before, after) {
    const { meta, nodes, edges, strings } = after;
    const nodeFields = meta.node_fields;
    const edgeFields = meta.edge_fields;
    const nodeTypes = meta.node_types[0];
    const edgeTypes = meta.edge_types[0];
    const nodeFieldCount = nodeFields.length;
    const edgeFieldCount = edgeFields.length;
    const typeField = nodeFields.indexOf('type');
    const nameField = nodeFields.indexOf('name');
    const idField = nodeFields.indexOf('id');
    const sizeField = nodeFields.indexOf('self_size');
    const edgeCountField = nodeFields.indexOf('edge_count');
    const edgeTypeField = edgeFields.indexOf('type');
    const edgeNameField = edgeFields.indexOf('name_or_index');
    const edgeToField = edgeFields.indexOf('to_node');
    const nodeCount = nodes.length / nodeFieldCount;

    const firstEdge = new Uint32Array(nodeCount + 1);
    for (let n = 0; n < nodeCount; n++) {
        firstEdge[n + 1] = firstEdge[n] + (nodes[(n * nodeFieldCount) + edgeCountField] * edgeFieldCount);
    }
    const isNew = n => !before.ids.has(nodes[(n * nodeFieldCount) + idField]);
    const sizeOf = n => nodes[(n * nodeFieldCount) + sizeField];
    const nameOf = n => {
        const type = nodeTypes[nodes[(n * nodeFieldCount) + typeField]];
        const name = strings[nodes[(n * nodeFieldCount) + nameField]] ?? '';
        switch (type) {
            case 'object':
            case 'native':
            case 'hidden':
            case 'synthetic': {
                return name.slice(0, 80);
            }
            case 'closure': {
                return `${name || '(anonymous)'}()`;
            }
            case 'string':
            case 'concatenated string':
            case 'sliced string': {
                return '(string)';
            }
            default: {
                return `(${type})`;
            }
        }
    };
    const edgeNameOf = e => {
        const type = edgeTypes[edges[e + edgeTypeField]];
        const name = edges[e + edgeNameField];
        return type === 'element' || type === 'hidden' ? `[${name}]` : String(strings[name] ?? name);
    };

    // the shortest path from the root to every object, over what holds it strongly: the retainers the
    // devtools list first. What only the stack or a handle scope holds is reached after everything
    // else: a value held there for a moment, while the snapshot is taken, says nothing of its owner
    const transient = new Set(['(Stack roots)', '(Handle scope)']);
    const parentEdge = new Int32Array(nodeCount).fill(-1);
    const parent = new Int32Array(nodeCount).fill(-1);
    const order = new Uint32Array(nodeCount);
    const deferred = [];
    let reached = 1;
    parent[0] = 0;
    const visit = (from, e) => {
        const to = edges[e + edgeToField] / nodeFieldCount;
        if (parent[to] === -1) {
            parent[to] = from;
            parentEdge[to] = e;
            order[reached++] = to;
        }
    };
    let deferredAt = 0;
    for (let head = 0; head < reached || deferredAt < deferred.length; head++) {
        if (head === reached) {
            const [from, e] = deferred[deferredAt++];
            visit(from, e);
            head--;
            continue;
        }
        const n = order[head];
        const isTransient = transient.has(strings[nodes[(n * nodeFieldCount) + nameField]]);
        for (let e = firstEdge[n]; e < firstEdge[n + 1]; e += edgeFieldCount) {
            if (edgeTypes[edges[e + edgeTypeField]] === 'weak') {
                continue;
            }
            if (isTransient) {
                deferred.push([n, e]);
                continue;
            }
            visit(n, e);
        }
    }

    // each new object hangs from the nearest object on its path that was there before: its anchor
    const anchor = new Int32Array(nodeCount).fill(-1);
    const anchorEdge = new Int32Array(nodeCount).fill(-1);
    const byName = new Map();
    const byAnchor = new Map();
    let newBytes = 0;
    let newCount = 0;
    for (let i = 1; i < reached; i++) {
        const n = order[i];
        if (!isNew(n)) {
            continue;
        }
        const p = parent[n];
        if (isNew(p)) {
            anchor[n] = anchor[p];
            anchorEdge[n] = anchorEdge[p];
        }
        else {
            anchor[n] = p;
            anchorEdge[n] = parentEdge[n];
        }
        const size = sizeOf(n);
        newBytes += size;
        newCount++;
        const name = nameOf(n);
        const named = byName.get(name) ?? { bytes: 0, count: 0 };
        named.bytes += size;
        named.count++;
        byName.set(name, named);
        const anchorKey = `${anchor[n]}:${anchorEdge[n]}`;
        const anchored = byAnchor.get(anchorKey) ?? { anchor: anchor[n], edge: anchorEdge[n], bytes: 0, count: 0, largest: n };
        anchored.bytes += size;
        anchored.count++;
        if (size > sizeOf(anchored.largest)) {
            anchored.largest = n;
        }
        byAnchor.set(anchorKey, anchored);
    }

    // each new object by the nearest variable or property on its path, such as the `chunks` of a
    // function: what in the code holds it. An object reached through the stack of async functions and
    // streams hangs from whatever runs at the moment, which says little of where it is kept
    const byVariable = new Map();
    for (let i = 1; i < reached; i++) {
        const n = order[i];
        if (!isNew(n)) {
            continue;
        }
        let at = n;
        while (at !== 0) {
            const e = parentEdge[at];
            const type = edgeTypes[edges[e + edgeTypeField]];
            if ((type === 'context' || type === 'property') && !['buffer', 'backing_store'].includes(edgeNameOf(e))) {
                break;
            }
            at = parent[at];
        }
        // a variable of a function's context is named with the function, the nearest one up its path
        let owner = at === 0 ? 0 : parent[at];
        while (owner !== 0 && nameOf(owner) === 'system / Context') {
            owner = parent[owner];
        }
        const ownerSuffix = at === 0 || owner === parent[at] ? '' : ` in ${nameOf(owner)}`;
        const key = at === 0 ? '(none)' : `${edgeNameOf(parentEdge[at])} of ${nameOf(parent[at])}${ownerSuffix}`;
        const held = byVariable.get(key) ?? { bytes: 0, count: 0, sample: n, members: [] };
        held.bytes += sizeOf(n);
        held.count++;
        held.members.push(n);
        if (sizeOf(n) > sizeOf(held.sample)) {
            held.sample = n;
        }
        byVariable.set(key, held);
    }

    // from the root, or from the object an anchor is, down to an object
    const pathTo = (n, from = 0) => {
        const steps = [];
        for (let at = n; at !== from && at !== 0 && steps.length < 40; at = parent[at]) {
            steps.unshift(`${edgeNameOf(parentEdge[at])} → ${nameOf(at)}`);
        }
        return steps;
    };

    // the different ways the objects of one group are held, each once, with how many bytes go each
    // way: a group of equal chunks has no largest one to stand for all of them
    const shapesOf = variable => {
        const shapes = new Map();
        for (const n of byVariable.get(variable)?.members ?? []) {
            const path = pathTo(n).slice(-24);
            const shape = path.map(step => step.replace(/^\[\d+\]|^\d+ /, '[]')).join('\n');
            const known = shapes.get(shape) ?? { bytes: 0, count: 0, path };
            known.bytes += sizeOf(n);
            known.count++;
            shapes.set(shape, known);
        }
        return [...shapes.values()].sort((a, b) => b.bytes - a.bytes);
    };
    return {
        newBytes,
        newCount,
        byName: [...byName].map(([name, { bytes, count }]) => ({ name, bytes, count })).sort((a, b) => b.bytes - a.bytes),
        byAnchor: [...byAnchor.values()]
            .map(a => ({ bytes: a.bytes, count: a.count, path: pathTo(a.anchor), inside: pathTo(a.largest, a.anchor) }))
            .sort((a, b) => b.bytes - a.bytes),
        byVariable: [...byVariable]
            .map(([variable, v]) => ({ variable, bytes: v.bytes, count: v.count, path: pathTo(v.sample) }))
            .sort((a, b) => b.bytes - a.bytes),
        shapesOf
    };
}

async function main() {
    const [beforeFile, afterFile, rows = '15', variable] = process.argv.slice(2);
    const growth = resolveHeapGrowth(await readHeapSnapshot(beforeFile, { idsOnly: true }), await readHeapSnapshot(afterFile));
    const mb = bytes => `${(bytes / MIB).toFixed(1).padStart(8)} MiB`;
    // a group named as the summary names it, such as "chunks of HttpClientBufferedBody": every way
    // its objects are held
    if (variable != undefined) {
        const shapes = growth.shapesOf(variable);
        process.stdout.write(`${shapes.slice(0, Number(rows)).flatMap(s => [
            `${mb(s.bytes)}  ${String(s.count).padStart(9)} objects held this way:`,
            ...s.path.map(step => `                      ${step}`)
        ])
            .join('\n')}\n`);
        return;
    }
    const lines = [
        `${mb(growth.newBytes)}  in ${growth.newCount} new objects`,
        '',
        'by what they are:',
        ...growth.byName.slice(0, Number(rows)).map(g => `${mb(g.bytes)}  ${String(g.count).padStart(9)}  ${g.name}`),
        '',
        'by the variable or property holding them, with the path to the largest of them:',
        ...growth.byVariable.slice(0, Number(rows)).flatMap(v => [
            `${mb(v.bytes)}  ${String(v.count).padStart(9)}  ${v.variable}`,
            ...v.path.slice(-24).map(step => `                      ${step}`)
        ]),
        '',
        'by what holds them, from the root to the object they hang from:',
        ...growth.byAnchor.slice(0, Number(rows)).flatMap(a => [
            `${mb(a.bytes)}  ${String(a.count).padStart(9)} objects`,
            // the end of the path names the holder; its start is the roots every path shares
            ...a.path.slice(-12).map(step => `                      ${step}`),
            '                    and inside it, down to the largest of them:',
            ...a.inside.slice(0, 16).map(step => `                      ${step}`)
        ])
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
}

await main();