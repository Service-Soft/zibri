// Rebuilds the data of one version of the HGB taxonomy the E-Bilanz is stated in, from the official zip of XBRL
// Deutschland e.V. (https://de.xbrl.org/taxonomien/), as a TypeScript file of the bookkeeping plugin. Run by a
// developer when a version is published, never at runtime, from packages/zibri:
//
//     node scripts/build-e-bilanz-taxonomy.mjs <zip> --allowed-from 2025-01-01 --mandatory-from 2026-01-01 [--out <file>]
//
// `--allowed-from` and `--mandatory-from` are the first day of the first fiscal year the version may be used for and
// has to be used for, from the letter of the Federal Ministry of Finance publishing it: the zip does not say. The zip is
// read as it is published, and nothing of it is kept but the extract written, which carries the copyright notice of
// XBRL Deutschland e.V. and says that it is shortened, as its terms (https://de.xbrl.org/disclaimer/) ask of a
// changed copy.
//
// What is extracted, for corporations (legalFormKSt) and the nature of expense method (no position of the UKV alone),
// leaving out what is not permitted in a filing to the tax administration:
// - the positions of the balance sheet, the income statement, the income statement of a micro corporation (MicroBilG),
//   the appropriation of profits and the steuerlicher Betriebsvermögensvergleich (BVV, the network transfersTaxAssets)
//   that the tax administration asks for (Mussfeld, Summenmussfeld, or required by
//   the calculation where present): each with its German label, the nearest such position above it in the
//   presentation, its balance side, and the positions it sums with their weights, from every calculation linkbase of
//   its network the entry point of a tax filing discovers.
//   Positions asked for by nobody, such as those "für individuelle Reportingzwecke", are left out.
// - the columns of the statement of changes in fixed assets (Anlagenspiegel, gross), from the book value at the end
//   of the period (`all`) down, with the columns each sums. Its rows are the members of its dimension of positions,
//   which the plugin states as the positions of the balance sheet below the fixed assets, with their parents and sums:
//   a version whose members are not those, in the same hierarchy, is refused.
// - the fields of the GCD module a corporation fills that the tax administration asks for.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { SaxesParser } = require('saxes');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// the networks read, by the name the plugin gives them, and the name of their linkbases and role
const STATEMENTS = {
    balanceSheet: 'balanceSheet',
    incomeStatement: 'incomeStatement',
    microIncomeStatement: 'incomeStatementMicroBilG',
    appropriationOfProfits: 'appropriationProfits',
    // the steuerlicher Betriebsvermögensvergleich (BVV)
    businessAssetComparison: 'transfersTaxAssets'
};

// the entry point of a tax filing each statement is read from, as the instance document references it: that of a
// micro corporation discovers a second calculation linkbase of its network, which sums its revenue, material and staff
const ENTRY_POINTS = {
    balanceSheet: 'shell-fiscal.xsd',
    incomeStatement: 'shell-fiscal.xsd',
    microIncomeStatement: 'shell-fiscal-microbilg.xsd',
    appropriationOfProfits: 'shell-fiscal.xsd',
    businessAssetComparison: 'shell-fiscal.xsd'
};

const SUMMATION_ITEM = 'http://www.xbrl.org/2003/arcrole/summation-item';

// the role of the statement of changes in fixed assets (gross), and its dimension whose members are its rows
const FIXED_ASSETS_ROLE = 'http://www.xbrl.de/taxonomies/de-gaap-ci/role/notesTableStatementOfChangesInFixedAssetsGross';
const FIXED_ASSETS_DIMENSION = 'dim_changes.nt.ass.gross';

const REQUIREMENTS = {
    Mussfeld: 'M',
    Summenmussfeld: 'S',
    'Rechnerisch notwendig, soweit vorhanden': 'R'
};

const LABEL_ROLE = 'http://www.xbrl.org/2003/role/label';
const REFERENCE_ROLE = 'http://www.xbrl.org/2003/role/mandatoryDisclosureRef';

/**
 * Reads the entries of a zip archive, stored or deflated.
 * @param zip - The archive.
 * @returns The names of its entries, and a function answering the content of the entry whose name ends with a suffix.
 * @throws An Error when the file is not a zip archive, or when no entry ends with the suffix asked for.
 */
function readZip(zip) {
    let end = zip.length - 22;
    while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) {
        end--;
    }
    if (end < 0) {
        throw new Error('The file is not a zip archive');
    }
    const count = zip.readUInt16LE(end + 10);
    let offset = zip.readUInt32LE(end + 16);
    const entries = new Map();
    for (let i = 0; i < count; i++) {
        const nameLength = zip.readUInt16LE(offset + 28);
        const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
        entries.set(name, {
            method: zip.readUInt16LE(offset + 10),
            compressedSize: zip.readUInt32LE(offset + 20),
            localOffset: zip.readUInt32LE(offset + 42)
        });
        offset += 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
    }
    const read = suffix => {
        const name = [...entries.keys()].find(n => n.endsWith(suffix));
        if (name == undefined) {
            throw new Error(`The zip holds no file ending with ${suffix}`);
        }
        const { method, compressedSize, localOffset } = entries.get(name);
        const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
        const data = zip.subarray(start, start + compressedSize);
        return (method === 0 ? data : inflateRawSync(data)).toString('utf8');
    };
    return { names: [...entries.keys()], read };
}

/**
 * Reads a linkbase: its locators, its arcs, each with the role of the link it is in, and its resources.
 * @param xml - The linkbase.
 * @returns What it holds.
 */
function readLinkbase(xml) {
    const parser = new SaxesParser();
    const locs = new Map();
    const arcs = [];
    const resources = new Map();
    let linkRole;
    let resource;
    let part;
    parser.on('opentag', tag => {
        const a = tag.attributes;
        if (tag.name.endsWith('Link')) {
            linkRole = a['xlink:role'];
        }
        else if (a['xlink:type'] === 'locator') {
            // the concept the fragment names, without the prefix of its schema
            locs.set(a['xlink:label'], a['xlink:href'].replace(/^.*#[^_]*_/, ''));
        }
        else if (a['xlink:type'] === 'arc') {
            arcs.push({
                role: linkRole,
                arcrole: a['xlink:arcrole'],
                from: a['xlink:from'],
                to: a['xlink:to'],
                order: Number(a.order ?? 0),
                weight: Number(a.weight ?? 1)
            });
        }
        else if (a['xlink:type'] === 'resource') {
            resource = { role: a['xlink:role'], text: '', parts: {} };
            resources.set(a['xlink:label'], resource);
        }
        else if (resource != undefined) {
            part = { name: tag.name.replace(/^.*:/, ''), text: '' };
        }
    });
    parser.on('text', text => {
        if (part != undefined) {
            part.text += text;
        }
        else if (resource != undefined) {
            resource.text += text;
        }
    });
    parser.on('closetag', () => {
        if (part != undefined) {
            resource.parts[part.name] = part.text.trim();
            part = undefined;
        }
        else if (resource != undefined) {
            resource.text = resource.text.trim();
            resource = undefined;
        }
    });
    parser.write(xml).close();
    return { locs, arcs, resources };
}

/**
 * Resolves the first resource of a role each concept of a resource linkbase has.
 * @param linkbase - The linkbase.
 * @param role - The role of the resources.
 * @returns The resource of each concept, by its name.
 */
function resolveResources(linkbase, role) {
    const res = new Map();
    for (const arc of linkbase.arcs) {
        const concept = linkbase.locs.get(arc.from);
        const resource = linkbase.resources.get(arc.to);
        if (concept != undefined && resource?.role === role && !res.has(concept)) {
            res.set(concept, resource);
        }
    }
    return res;
}

/**
 * Resolves the linkbases an entry point discovers: those its schema references, and those of each schema of its module
 * it imports, transitively.
 * @param read - Answers the content of the entry of the zip whose name ends with a suffix.
 * @param dir - The directory of the module, such as `/de-gaap-ci-2025-04-01/`.
 * @param schema - The file name of the entry point.
 * @returns The file names of the linkbases, in the order they are referenced.
 */
function resolveLinkbases(read, dir, schema) {
    const res = [];
    const visited = new Set();
    const visit = name => {
        if (visited.has(name)) {
            return;
        }
        visited.add(name);
        const xsd = read(`${dir}${name}`);
        for (const match of xsd.matchAll(/<link:linkbaseRef\b[^>]*?xlink:href="([^"]+)"/g)) {
            if (!res.includes(match[1])) {
                res.push(match[1]);
            }
        }
        // the schemas of the same module: those of another, such as the roles of the GCD module, hold no network read
        for (const match of xsd.matchAll(/<xs:import\b[^>]*?schemaLocation="([^"/:]+)"/g)) {
            visit(match[1]);
        }
    };
    visit(schema);
    return res;
}

/**
 * Resolves the children of each concept of a network, by the arcs of one arcrole.
 * @param linkbases - The linkbases holding the network, the arcs of all of them its relationships.
 * @param isArc - Whether an arc is one of the network.
 * @returns The children of each concept in their order, with the weight of their arc.
 */
function resolveChildren(linkbases, isArc) {
    const res = new Map();
    for (const linkbase of linkbases) {
        for (const arc of linkbase.arcs.filter(isArc)) {
            const from = linkbase.locs.get(arc.from);
            const to = linkbase.locs.get(arc.to);
            const children = res.get(from) ?? [];
            // an arc two linkbases both hold is one relationship
            if (!children.some(c => c.name === to)) {
                res.set(from, [...children, { name: to, order: arc.order, weight: arc.weight }]);
            }
        }
    }
    for (const children of res.values()) {
        children.sort((a, b) => a.order - b.order);
    }
    return res;
}

/**
 * Reads the balance side of each concept a schema declares one of, and of each other amount.
 * @param xsd - The schema.
 * @returns `D` for debit or `C` for credit, or null for an amount without a side, by the name of the concept.
 */
function readBalances(xsd) {
    const res = new Map();
    for (const match of xsd.matchAll(/<xs:element\s[^>]*?name="([^"]+)"[^>]*?>/g)) {
        const balance = /xbrli:balance="(\w+)"/.exec(match[0])?.[1];
        if (balance != undefined) {
            res.set(match[1], balance === 'debit' ? 'D' : 'C');
        }
        // an amount the schema gives no side, such as the result of the BVV, which sums amounts of both
        else if (/type="xbrli:monetaryItemType"/.test(match[0])) {
            res.set(match[1], null);
        }
    }
    return res;
}

/**
 * Resolves the balance side of a position: its own, or for an amount without one that of the first position it adds,
 * so that a sum states its parts as they are, such as the result of the BVV the side of the equity at the end.
 * @param name - The name of the concept.
 * @param balances - The side of each concept, null for an amount without one.
 * @param sums - The parts of each sum, with their weights.
 * @returns `D` or `C`, or undefined for neither.
 */
function resolveBalance(name, balances, sums) {
    const own = balances.get(name);
    if (own != undefined) {
        return own;
    }
    const added = (sums.get(name) ?? []).find(s => s.weight > 0 && balances.get(s.name) != undefined);
    return added == undefined ? undefined : balances.get(added.name);
}

/**
 * Whether a corporation reports a concept to the tax administration, by its fiscal reference.
 * @param reference - The reference, or undefined for a concept without one.
 * @returns Whether it does.
 */
function isOfCorporations(reference) {
    const parts = reference?.parts ?? {};
    return parts.legalFormKSt === 'true'
        && parts.typeOperatingResult !== 'UKV'
        && parts.notPermittedFor !== 'steuerlich'
        && parts.notPermittedFor !== 'Einreichung an Finanzverwaltung';
}

/**
 * Validates that the members of the dimension of positions of the statement of changes in fixed assets, as the entry
 * point of a tax filing discovers them, are the positions of the balance sheet extracted below its domain, the fixed
 * assets, each below the member its parent in the extract is.
 * @param read - Answers the content of the entry of the zip whose name ends with a suffix.
 * @param date - The date of the version.
 * @param balanceSheet - The positions of the balance sheet extracted.
 * @throws An Error naming the first position that is not.
 */
function validateFixedAssetMembers(read, date, balanceSheet) {
    const dir = `/de-gaap-ci-${date}/`;
    const linkbases = resolveLinkbases(read, dir, `de-gaap-ci-${date}-shell-fiscal.xsd`)
        .filter(name => name.includes('notesTableStmOfChgInFAssGross'))
        .map(name => readLinkbase(read(`${dir}${name}`)));
    const children = resolveChildren(
        linkbases,
        a => a.role === FIXED_ASSETS_ROLE && (a.arcrole === 'http://xbrl.org/int/dim/arcrole/dimension-domain' || a.arcrole === 'http://xbrl.org/int/dim/arcrole/domain-member')
    );
    const domain = children.get(FIXED_ASSETS_DIMENSION)?.[0]?.name;
    const parents = new Map();
    const visit = (name, parent) => {
        if (!parents.has(name)) {
            parents.set(name, parent);
            for (const child of children.get(name) ?? []) {
                visit(child.name, name);
            }
        }
    };
    if (domain == undefined || !balanceSheet.some(r => r.name === domain)) {
        throw new Error(
            `The dimension ${FIXED_ASSETS_DIMENSION} of the statement of changes in fixed assets`
            + ' has no domain among the positions of the balance sheet'
        );
    }
    visit(domain, null);
    const extracted = new Set(balanceSheet.map(r => r.name));
    for (const row of balanceSheet.filter(r => r.name.startsWith(`${domain}.`))) {
        // the nearest member above it that is extracted, as its parent in the extract is the nearest position above it
        let parent = parents.get(row.name);
        while (parent != undefined && !extracted.has(parent)) {
            parent = parents.get(parent);
        }
        if (!parents.has(row.name) || parent !== row.parent) {
            throw new Error(`The position ${row.name} of the balance sheet is no member of ${FIXED_ASSETS_DIMENSION} below ${row.parent}`);
        }
    }
}

/**
 * Reads the extract of one version from its zip.
 * @param zip - The zip.
 * @returns The version, its date and what it holds.
 * @throws An Error when the zip is no HGB taxonomy, or when what it holds is not what the plugin states.
 */
function extract(zip) {
    const { names, read } = readZip(zip);
    const version = /<tp:version>([^<]+)<\/tp:version>/.exec(read('META-INF/taxonomyPackage.xml'))?.[1];
    const date = names.map(n => /\/de-gaap-ci-(\d{4}-\d{2}-\d{2})\.xsd$/.exec(n)?.[1]).find(d => d != undefined);
    if (version == undefined || date == undefined) {
        throw new Error('The zip is no HGB taxonomy: it names no version or holds no de-gaap-ci schema');
    }
    const gaap = name => read(`/de-gaap-ci-${date}/de-gaap-ci-${date}-${name}`);
    const gcd = name => read(`/de-gcd-${date}/de-gcd-${date}-${name}`);

    const balances = readBalances(read(`/de-gaap-ci-${date}/de-gaap-ci-${date}.xsd`));
    const labels = resolveResources(readLinkbase(gaap('label-de.xml')), LABEL_ROLE);
    const references = resolveResources(readLinkbase(gaap('reference-fiscal.xml')), REFERENCE_ROLE);
    const requirementOf = name => {
        const reference = references.get(name);
        return isOfCorporations(reference) ? REQUIREMENTS[reference.parts.fiscalRequirement] : undefined;
    };

    const statements = {};
    // a concept of two networks, such as the net income, is a position of the first
    const kept = new Set();
    const linkbases = new Map();
    const calculationsOf = entryPoint => resolveLinkbases(read, `/de-gaap-ci-${date}/`, `de-gaap-ci-${date}-${entryPoint}`)
        .filter(name => name.startsWith(`de-gaap-ci-${date}-calculation-`))
        .map(name => {
            if (!linkbases.has(name)) {
                linkbases.set(name, readLinkbase(read(`/de-gaap-ci-${date}/${name}`)));
            }
            return linkbases.get(name);
        });
    for (const [statement, network] of Object.entries(STATEMENTS)) {
        const role = `http://www.xbrl.de/taxonomies/de-gaap-ci/role/${network}`;
        const children = resolveChildren(
            [readLinkbase(gaap(`presentation-${network}.xml`))],
            a => a.role === role && a.arcrole === 'http://www.xbrl.org/2003/arcrole/parent-child'
        );
        const sums = resolveChildren(calculationsOf(ENTRY_POINTS[statement]), a => a.role === role && a.arcrole === SUMMATION_ITEM);
        const targets = new Set([...children.values()].flat().map(c => c.name));
        const rows = [];
        const visit = (name, parent, ancestors) => {
            if (ancestors.includes(name)) {
                return;
            }
            const requirement = requirementOf(name);
            const balance = resolveBalance(name, balances, sums);
            const isPosition = requirement != undefined && balance != undefined && !kept.has(name);
            if (isPosition) {
                kept.add(name);
                rows.push({ name, parent, balance, requirement, label: labels.get(name)?.text ?? name, sums: sums.get(name) ?? [] });
            }
            for (const child of children.get(name) ?? []) {
                visit(child.name, isPosition ? name : parent, [...ancestors, name]);
            }
        };
        for (const top of [...children.keys()].filter(n => !targets.has(n))) {
            visit(top, null, []);
        }
        statements[statement] = rows;
    }
    // the sums of the positions extracted, over positions extracted, of whichever statement. Left out where a position
    // sums its children in the extract and nothing else, which most do
    for (const rows of Object.values(statements)) {
        for (const row of rows) {
            const sums = row.sums.filter(s => kept.has(s.name)).map(s => s.weight < 0 ? `-${s.name}` : s.name);
            const children = rows.filter(r => r.parent === row.name).map(r => r.name);
            const implied = sums.length === children.length && sums.every(s => children.includes(s));
            row.sums = implied ? undefined : sums;
        }
    }
    validateFixedAssetMembers(read, date, statements.balanceSheet);

    const dimensionLabels = resolveResources(readLinkbase(gaap('dimensions-label-de.xml')), LABEL_ROLE);
    const dimensionReferences = resolveResources(readLinkbase(gaap('dimensions-reference-fiscal.xml')), REFERENCE_ROLE);
    const members = resolveChildren(
        [readLinkbase(gaap('dimensions-presentation-notesTableStmOfChgInFAssGross.xml'))],
        a => a.arcrole.endsWith('parent-child')
    );
    // the calculation of the gross statement alone: the other statements of changes share its role and its columns
    const columnSums = resolveChildren(
        [readLinkbase(gaap('dimensions-calculation-notesTableStmOfChgInFAssGross.xml'))],
        a => a.arcrole === SUMMATION_ITEM
    );
    const columns = [];
    const visitColumn = (name, parent) => {
        if (columns.some(c => c.name === name)) {
            return;
        }
        const reference = dimensionReferences.get(name);
        columns.push({
            name,
            parent,
            requirement: REQUIREMENTS[reference?.parts.fiscalRequirement] ?? null,
            label: dimensionLabels.get(name)?.text ?? name,
            sums: columnSums.get(name) ?? []
        });
        for (const child of members.get(name) ?? []) {
            visitColumn(child.name, name);
        }
    };
    // the book value at the end of the period, and every column of the gross statement below it
    visitColumn('all', null);
    if (columns.length < 2) {
        throw new Error('The statement of changes in fixed assets has no columns below "all"');
    }
    // as the sums of the positions: left out where a column sums its children and nothing else
    for (const column of columns) {
        const sums = column.sums.filter(s => columns.some(c => c.name === s.name)).map(s => s.weight < 0 ? `-${s.name}` : s.name);
        const children = columns.filter(c => c.parent === column.name).map(c => c.name);
        const implied = sums.length === children.length && sums.every(s => children.includes(s));
        column.sums = implied ? undefined : sums;
    }

    const gcdLabels = resolveResources(readLinkbase(gcd('label-de.xml')), LABEL_ROLE);
    const gcdReferences = resolveResources(readLinkbase(gcd('reference-fiscal.xml')), REFERENCE_ROLE);
    const gcdPresentation = readLinkbase(gcd('presentation.xml'));
    const gcdFields = [];
    for (const arc of gcdPresentation.arcs.filter(a => a.arcrole === 'http://www.xbrl.org/2003/arcrole/parent-child')) {
        for (const name of [gcdPresentation.locs.get(arc.from), gcdPresentation.locs.get(arc.to)]) {
            const parts = gcdReferences.get(name)?.parts;
            const requirement = REQUIREMENTS[parts?.fiscalRequirement];
            if (parts?.legalFormKSt !== 'true' || requirement == undefined || gcdFields.some(f => f.name === name)) {
                continue;
            }
            gcdFields.push({ name, requirement, label: gcdLabels.get(name)?.text ?? name });
        }
    }
    return { version, date, statements, columns, gcdFields };
}

/**
 * Writes a value as a string literal of TypeScript.
 * @param value - The value.
 * @returns The literal, in single quotes.
 */
function literal(value) {
    return value == undefined
        ? 'null'
        : `'${value.replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')
            .replaceAll(/\s+/g, ' ')}'`;
}

/**
 * Renders the extract as the TypeScript file of its version.
 * @param data - The extract.
 * @param source - The name and the SHA-256 of the zip.
 * @param allowedFrom - The first day of the first fiscal year it may be used for.
 * @param mandatoryFrom - The first day of the first fiscal year it has to be used for.
 * @param base - The extract of the version before it, to state it as what it changes of that, or undefined to state it whole.
 * @returns The file.
 */
function render(data, source, allowedFrom, mandatoryFrom, base) {
    const id = data.version.replaceAll('.', '_');
    const sumsOf = r => r.sums == undefined ? '' : `, [${r.sums.map(literal).join(', ')}]`;
    const row = r => {
        const values = [literal(r.name), literal(r.parent), literal(r.balance), literal(r.requirement), literal(r.label)];
        return `[${values.join(', ')}${sumsOf(r)}]`;
    };
    const header = [
        '/* eslint-disable cspell/spellchecker, stylistic/max-len, sonar/no-duplicate-string */',
        '// (c) XBRL Deutschland e.V. - see http://www.xbrl.de',
        `// Extracted from ${source.name} (SHA-256 ${source.hash}) by scripts/build-e-bilanz-taxonomy.mjs, and shortened:`,
        '// the positions, columns and fields a corporation reports to the tax administration. Rebuild it with the script',
        '// rather than changing it by hand.'
    ];
    const meta = [
        `    version: ${literal(data.version)},`,
        `    date: ${literal(data.date)},`,
        '    adapter: \'hgb-6\',',
        `    allowedFrom: new Date('${allowedFrom}T00:00:00.000Z'),`,
        `    mandatoryFrom: new Date('${mandatoryFrom}T00:00:00.000Z'),`,
        '    notice: \'© XBRL Deutschland e.V., see http://www.xbrl.de. Shortened to what a corporation reports to the tax administration.\','
    ];
    const column = c => `[${[literal(c.name), literal(c.parent), literal(c.requirement), literal(c.label)].join(', ')}${sumsOf(c)}]`;
    const columns = `    fixedAssetColumns: [\n${data.columns.map(c => `        ${column(c)}`).join(',\n')}\n    ],`;
    const field = f => `[${[literal(f.name), literal(f.requirement), literal(f.label)].join(', ')}]`;
    const fields = `    gcdFields: [\n${data.gcdFields.map(f => `        ${field(f)}`).join(',\n')}\n    ]`;
    const doc = [
        '/**',
        ` * Version ${data.version} of the HGB taxonomy of the E-Bilanz, of ${data.date}, as far as a corporation reports it: the`,
        ' * positions of its statements and of the appropriation of its profits, the columns of the statement of changes in',
        ' * fixed assets and the fields of the GCD module the tax administration asks for. © XBRL Deutschland e.V., shortened.',
        ' */'
    ];
    if (base != undefined) {
        // what the version changes of the one before it, which it is resolved from: far less to review than all of it
        const baseId = base.data.version.replaceAll('.', '_');
        const changes = Object.keys(STATEMENTS).map(name => {
            const before = new Map(base.data.statements[name].map(r => [r.name, row(r)]));
            const rows = data.statements[name];
            const changed = rows.flatMap((r, index) => before.get(r.name) === row(r)
                ? []
                : [`            { after: ${literal(rows[index - 1]?.name)}, row: ${row(r)} }`]);
            const names = new Set(rows.map(r => r.name));
            const removed = [...before.keys()].filter(n => !names.has(n));
            const rowsOf = changed.length ? `[\n    ${changed.join(',\n    ')}\n            ]` : '[]';
            return `        ${name}: {\n            removed: [${removed.map(literal).join(', ')}],\n            rows: ${rowsOf}\n        }`;
        });
        return [
            ...header,
            '// Stated as what it changes of the version before it.',
            'import { EBilanzTaxonomyUtilities } from \'../e-bilanz-taxonomy.utilities\';',
            'import { type EBilanzTaxonomy } from \'../models/e-bilanz-taxonomy.model\';',
            `import { HGB_TAXONOMY_${baseId} } from './hgb-taxonomy-${base.data.version.replaceAll('.', '-')}.model';`,
            '',
            ...doc,
            `export const HGB_TAXONOMY_${id}: EBilanzTaxonomy = EBilanzTaxonomyUtilities.resolveChanged(HGB_TAXONOMY_${baseId}, {`,
            ...meta,
            `    statements: {\n${changes.join(',\n')}\n    },`,
            columns,
            fields,
            '});',
            ''
        ].join('\n');
    }
    const statement = name => `    ${name}: [\n${data.statements[name].map(r => `        ${row(r)}`).join(',\n')}\n    ]`;
    return [
        ...header,
        'import { type EBilanzTaxonomy } from \'../models/e-bilanz-taxonomy.model\';',
        '',
        ...doc,
        `export const HGB_TAXONOMY_${id}: EBilanzTaxonomy = {`,
        ...meta,
        `    statements: {\n${Object.keys(STATEMENTS).map(name => `    ${statement(name)}`)
            .join(',\n')}\n    },`,
        columns,
        fields,
        '};',
        ''
    ].join('\n');
}

/**
 * Builds the file of the version of the zip the command line names, and writes it.
 * @throws An Error when the command line is not the usage, or when the zip cannot be extracted.
 */
function main() {
    const [file, ...rest] = process.argv.slice(2);
    const option = name => {
        const index = rest.indexOf(`--${name}`);
        return index === -1 ? undefined : rest[index + 1];
    };
    const allowedFrom = option('allowed-from');
    const mandatoryFrom = option('mandatory-from');
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (file == undefined || !day.test(allowedFrom ?? '') || !day.test(mandatoryFrom ?? '')) {
        throw new Error(
            'Usage: node scripts/build-e-bilanz-taxonomy.mjs <zip> --allowed-from <YYYY-MM-DD> --mandatory-from <YYYY-MM-DD>'
            + ' [--base <zip of the version before>] [--out <file>]'
        );
    }
    const zip = readFileSync(file);
    const data = extract(zip);
    const source = {
        name: path.basename(file),
        hash: createHash('sha256').update(zip)
            .digest('hex')
    };
    const baseFile = option('base');
    const base = baseFile == undefined ? undefined : { data: extract(readFileSync(baseFile)) };
    const out = option('out')
        ?? path.join(
            root,
            'src',
            'plugin',
            'bookkeeping',
            'e-bilanz',
            'taxonomies',
            `hgb-taxonomy-${data.version.replaceAll('.', '-')}.model.ts`
        );
    writeFileSync(out, render(data, source, allowedFrom, mandatoryFrom, base));
    const positions = Object.values(data.statements).reduce((sum, rows) => sum + rows.length, 0);
    process.stdout.write(`${out}: ${positions} positions, ${data.columns.length} columns, ${data.gcdFields.length} fields\n`);
}

main();