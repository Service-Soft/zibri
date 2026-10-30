/* eslint-disable jsdoc/require-jsdoc */
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeHeapSnapshot } from 'node:v8';

import { runCLI } from 'jest';

// Jest gives every test file an environment of its own, a vm context, and drops it once the file is
// done. Whatever outlives the file and still reaches into that context keeps all of it alive: every
// module the file loaded, a few dozen megabytes for a file that loads the framework. A worker then
// grows with every file it runs until the machine runs out of memory.
//
// This runs the given test files in this process, one after the other, writes a heap snapshot once
// they are done, and prints for every context still alive the shortest chain of references that
// holds it. The first link that belongs to no test file is the culprit.
//
//   cd packages/zibri && node scripts/find-retained-test-environments.mjs <test file> [<test file> ...]

const MAX_REPORTED_CONTEXTS = 5;

const MAX_SHOWN_STEPS = 40;

const EPHEMERON_EDGE = /^\d+ \/ part of key .* pair in WeakMap/;

function runTests(testFiles) {
    return runCLI({ _: testFiles, $0: 'jest', runInBand: true, silent: true }, [process.cwd()]);
}

function readSnapshot() {
    // written after the run: taking a snapshot collects garbage first, so what is left is held
    const file = writeHeapSnapshot(path.join(tmpdir(), `retained-test-environments-${process.pid}.heapsnapshot`));
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    }
    finally {
        rmSync(file, { force: true });
    }
}

function toGraph(snapshot) {
    const { node_fields: nodeFields, edge_fields: edgeFields, node_types: [nodeTypes], edge_types: [edgeTypes] } = snapshot.snapshot.meta;
    const nodeFieldCount = nodeFields.length;
    const edgeFieldCount = edgeFields.length;
    const { nodes, edges, strings } = snapshot;
    const nodeCount = nodes.length / nodeFieldCount;
    // where each node's edges start in the flat edge list, which holds them in node order
    const firstEdge = new Uint32Array(nodeCount + 1);
    for (let node = 0; node < nodeCount; node++) {
        firstEdge[node + 1] = firstEdge[node] + (nodes[(node * nodeFieldCount) + nodeFields.indexOf('edge_count')] * edgeFieldCount);
    }
    return {
        nodeCount,
        nodeType: node => nodeTypes[nodes[(node * nodeFieldCount) + nodeFields.indexOf('type')]],
        nodeName: node => strings[nodes[(node * nodeFieldCount) + nodeFields.indexOf('name')]],
        * edgesOf(node) {
            for (let edge = firstEdge[node]; edge < firstEdge[node + 1]; edge += edgeFieldCount) {
                const type = edgeTypes[edges[edge + edgeFields.indexOf('type')]];
                const nameOrIndex = edges[edge + edgeFields.indexOf('name_or_index')];
                yield {
                    type,
                    // elements and hidden edges are numbered, every other kind is named
                    name: type === 'element' || type === 'hidden' ? `[${nameOrIndex}]` : strings[nameOrIndex],
                    to: edges[edge + edgeFields.indexOf('to_node')] / nodeFieldCount
                };
            }
        }
    };
}

// the shortest strong path from the root to every node, as the edge each node was first reached by
function resolveRetainers(graph) {
    const retainedBy = new Array(graph.nodeCount);
    const queue = new Uint32Array(graph.nodeCount);
    let head = 0;
    let tail = 0;
    queue[tail++] = 0;
    retainedBy[0] = null;
    while (head < tail) {
        const node = queue[head++];
        for (const edge of graph.edgesOf(node)) {
            // a weak reference keeps nothing alive, and a shortcut repeats a path that exists anyway.
            // The snapshot also draws an edge from a WeakMap key to its value, which keeps the value
            // only while the map is alive as well - followed alone, it names the key as the holder of
            // every value of a map that is itself held by something else
            if (edge.type === 'weak' || edge.type === 'shortcut' || EPHEMERON_EDGE.test(edge.name) || retainedBy[edge.to] !== undefined) {
                continue;
            }
            retainedBy[edge.to] = { from: node, edge };
            queue[tail++] = edge.to;
        }
    }
    return retainedBy;
}

// a function by its name and, since most that matter are anonymous, the file it was written in
function describeNode(graph, node) {
    const description = `${graph.nodeName(node)} (${graph.nodeType(node)})`;
    if (graph.nodeType(node) !== 'closure') {
        return description;
    }
    const shared = [...graph.edgesOf(node)].find(edge => edge.name === 'shared')?.to;
    const script = shared == undefined ? undefined : [...graph.edgesOf(shared)].find(edge => /^script/.test(edge.name))?.to;
    const file = script == undefined ? undefined : [...graph.edgesOf(script)].find(edge => edge.name === 'name')?.to;
    return file == undefined ? description : `${description} in ${graph.nodeName(file)}`;
}

function describePath(graph, retainedBy, node) {
    const steps = [];
    for (let current = node; retainedBy[current] != undefined; current = retainedBy[current].from) {
        const { from, edge } = retainedBy[current];
        steps.unshift(`${describeNode(graph, from)} --${edge.type}:${edge.name}-->`);
    }
    const shown = steps.length > MAX_SHOWN_STEPS
        ? [...steps.slice(0, MAX_SHOWN_STEPS / 2), `... ${steps.length - MAX_SHOWN_STEPS} steps ...`, ...steps.slice(-MAX_SHOWN_STEPS / 2)]
        : steps;
    return [...shown, `${graph.nodeName(node)} (${graph.nodeType(node)})`].map(step => `    ${step}`).join('\n');
}

// whoever else points at the holder: the object that owns it is usually among them
function describeReferrers(graph, node) {
    const lines = [];
    for (let from = 0; from < graph.nodeCount && lines.length < MAX_SHOWN_STEPS / 2; from++) {
        for (const edge of graph.edgesOf(from)) {
            if (edge.to === node && edge.type !== 'shortcut') {
                lines.push(`      ${graph.nodeName(from)} (${graph.nodeType(from)}) --${edge.type}:${edge.name}-->`);
            }
        }
    }
    return lines;
}

// two levels and more for what a holder keeps in a collection, such as the listeners of an event target
function describeReferences(graph, node, depth, indent) {
    const lines = [];
    for (const edge of graph.edgesOf(node)) {
        if (
            edge.type === 'shortcut'
            || edge.type === 'weak'
            || graph.nodeType(edge.to) === 'hidden'
            || graph.nodeType(edge.to) === 'code'
        ) {
            continue;
        }
        lines.push(`${indent}${edge.type}:${edge.name} -> ${graph.nodeName(edge.to)} (${graph.nodeType(edge.to)})`);
        if (depth > 1 && ['object', 'array'].includes(graph.nodeType(edge.to)) && edge.name !== '__proto__') {
            lines.push(...describeReferences(graph, edge.to, depth - 1, `${indent}  `));
        }
    }
    return lines.slice(0, MAX_SHOWN_STEPS);
}

// what the first object on the path refers to, which usually says whose it is: a handler, an owner
function describeHolder(graph, retainedBy, node) {
    let holder = node;
    while (retainedBy[holder] != undefined && graph.nodeType(retainedBy[holder].from) !== 'synthetic') {
        holder = retainedBy[holder].from;
    }
    return [
        `    held by ${graph.nodeName(holder)}, which refers to:`,
        ...describeReferences(graph, holder, 3, '      '),
        '    and is referred to by:',
        ...describeReferrers(graph, holder)
    ].join('\n');
}

const testFiles = process.argv.slice(2);
if (!testFiles.length) {
    // eslint-disable-next-line no-console
    console.error('Name the test files to run.');
    process.exit(1);
}

await runTests(testFiles);
const graph = toGraph(readSnapshot());
const retainedBy = resolveRetainers(graph);
const contexts = [];
for (let node = 0; node < graph.nodeCount; node++) {
    if (graph.nodeType(node) === 'hidden' && graph.nodeName(node).startsWith('system / NativeContext') && retainedBy[node] !== undefined) {
        contexts.push(node);
    }
}
// one of them is the context this script runs in; every other one is an environment that was kept
// eslint-disable-next-line no-console
console.log(`${contexts.length} contexts alive after ${testFiles.length} test files, this script's own included.\n`);
for (const context of contexts.slice(0, MAX_REPORTED_CONTEXTS)) {
    // eslint-disable-next-line no-console
    console.log(`${describePath(graph, retainedBy, context)}\n${describeHolder(graph, retainedBy, context)}\n`);
}