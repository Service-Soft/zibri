/* eslint-disable jsdoc/require-jsdoc */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// XBRL Deutschland publishes each version of the HGB taxonomy on a page of its own below /taxonomien/, which links
// the official zip. The page names are written by hand and follow no pattern, the zips do
const indexUrls = ['https://de.xbrl.org/taxonomien/', 'https://de.xbrl.org/'];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function parseTaxonomyPages(html) {
    return [...new Set([...html.matchAll(/href="(https:\/\/de\.xbrl\.org\/taxonomien\/[^"#?]+\/)"/g)].map(m => m[1]))];
}

export function parsePublishedVersions(html) {
    return [...html.matchAll(/german-gaap-taxonomy-v(\d+\.\d+)-(\d{4}-\d{2}-\d{2})\.zip/g)].map(m => ({ version: m[1], date: m[2] }));
}

// what needs a developer: a version published that zibri does not ship, and a fiscal year starting this year, or
// from October the next one, that no version shipped needs to be stated in. Each year has a version of its own, so a
// fiscal year needs the one mandatory from its year. October, as the letter of the ministry publishing a version comes
// in June and ERiC takes test cases of it from November
export function findTaxonomyProblems(published, shipped, today) {
    const problems = [];
    // the pages list the versions of years past too, which nobody files in any more
    const order = version => version.split('.').map(Number).reduce((sum, part) => sum * 1000 + part, 0);
    const newest = Math.max(...shipped.map(t => order(t.version)));
    for (const { version, date } of published) {
        if (order(version) > newest && !problems.some(p => p.includes(` ${version} `))) {
            problems.push(`The HGB taxonomy ${version} of ${date} is published and not shipped: rebuild its data with packages/zibri/scripts/build-e-bilanz-taxonomy.mjs.`);
        }
    }
    const year = Number(today.slice(0, 4));
    const years = today.slice(5) >= '10-01' ? [year, year + 1] : [year];
    for (const fiscalYear of years) {
        if (!shipped.some(t => t.mandatoryFrom.slice(0, 4) === String(fiscalYear))) {
            problems.push(`The fiscal year ${fiscalYear} has no version of the HGB taxonomy it needs to be stated in.`);
        }
    }
    return problems;
}

async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${url} answered ${response.status}`);
    }
    return await response.text();
}

async function main() {
    // what the package ships, from its build, as an application reads it
    const require = createRequire(import.meta.url);
    const { E_BILANZ_TAXONOMIES } = require(path.join(repoRoot, 'packages', 'zibri', 'dist', 'cjs', 'index.js'));
    const shipped = E_BILANZ_TAXONOMIES.map(t => ({ version: t.version, mandatoryFrom: t.mandatoryFrom.toISOString().slice(0, 10) }));
    // a site that cannot be read fails the check rather than passing it: nobody would notice a check that never runs
    const pages = [...new Set((await Promise.all(indexUrls.map(fetchText))).flatMap(parseTaxonomyPages))];
    const published = (await Promise.all(pages.map(fetchText))).flatMap(parsePublishedVersions);
    if (!published.length) {
        throw new Error(`No version of the HGB taxonomy is linked from ${indexUrls.join(' or ')}: the pages changed, and this check needs to follow.`);
    }
    const problems = findTaxonomyProblems(published, shipped, new Date().toISOString().slice(0, 10));
    for (const problem of problems) {
        process.stderr.write(`${problem}\n`);
    }
    process.stdout.write(`published: ${[...new Set(published.map(p => p.version))].join(', ')}; shipped: ${shipped.map(t => t.version).join(', ')}\n`);
    process.exitCode = problems.length ? 1 : 0;
}

// argv[1] is undefined when this module is imported by a `--eval` script rather than run
if (process.argv[1] != undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
