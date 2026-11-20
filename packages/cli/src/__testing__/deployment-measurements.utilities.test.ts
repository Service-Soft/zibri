import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { addMapping, GenMapping, toEncodedMap } from '@jridgewell/gen-mapping';

import { FsUtilities } from '../encapsulation';
import { Path } from '../utilities';
import { BundlePart } from './bundle-part.model';
import { DeploymentMeasurement } from './deployment-measurement.model';
import { DeploymentMeasurementUtilities } from './deployment-measurements.utilities';
import { emptyWorkDirectory } from './empty-work-directory.function';

let workDir: Path;
let reportPath: Path;
let baselinePath: Path;

const run: DeploymentMeasurement[] = [
    { name: 'image', value: 250_000_000, unit: 'bytes' },
    { name: 'time to ready', value: 4000, unit: 'ms' },
    { name: 'bundle', value: 8_000_000, unit: 'bytes' }
];

beforeAll(async () => {
    workDir = await emptyWorkDirectory('deployment-measurements');
    reportPath = path.join(workDir, 'report.json') as Path;
    baselinePath = path.join(workDir, 'baseline.json') as Path;
});

afterAll(async () => {
    await FsUtilities.rm(workDir);
});

// what a built deployment weighs and how long it takes to answer, reported against a
// baseline the way the benchmark job reports timings, and never gated
describe('DeploymentMeasurementUtilities', () => {
    it('reports every measurement without a baseline, and records one when asked', async () => {
        const report: string = await DeploymentMeasurementUtilities.resolveReport(run, reportPath, baselinePath, true);

        expect(report).toContain('image');
        expect(report.split('\n').filter(line => line.includes('no baseline'))).toHaveLength(3);
        expect(JSON.parse(await FsUtilities.readFile(baselinePath))).toEqual(run);
        expect(JSON.parse(await FsUtilities.readFile(reportPath))).toEqual(run.map(measurement => ({ measurement, baseline: undefined })));
    });

    it('says what grew past the margin, as larger for a size and slower for a time', async () => {
        const later: DeploymentMeasurement[] = [
            { name: 'image', value: 400_000_000, unit: 'bytes' },
            { name: 'time to ready', value: 7000, unit: 'ms' },
            { name: 'bundle', value: 8_500_000, unit: 'bytes' }
        ];

        const report: string = await DeploymentMeasurementUtilities.resolveReport(later, reportPath, baselinePath, false);

        const lines: string[] = report.split('\n');
        expect(lines.find(line => line.startsWith('image'))).toMatch(/400\.0 MB\s+250\.0 MB\s+1\.60x, larger$/);
        expect(lines.find(line => line.startsWith('time to ready'))).toMatch(/7\.0 s\s+4\.0 s\s+1\.75x, slower$/);
        expect(lines.find(line => line.startsWith('bundle'))).toMatch(/1\.06x$/);
        // the baseline stays what was recorded
        expect(JSON.parse(await FsUtilities.readFile(baselinePath))).toEqual(run);
    });

    // what a bundle over its limit is made of, so that the failure names what grew. Shaped as webpack writes one without
    // minifying it: each module between lines of its own, indented, with lines the compiler of its source added that
    // map to nothing in it. Counted as unmapped, those were a third of the bundle of a generated project
    it('breaks a bundle down by the packages its source map names, the framework by its folders, each module whole', () => {
        const bundle: string = [
            '/******/ (() => {',
            '/***/ ((module) => {',
            '"use strict";',
            '    var a=1;var b=2;',
            '/***/ }),',
            '/***/ ((module) => {',
            '    var c=3;',
            '    exports.c = c;',
            '/***/ }),',
            '/***/ ((module) => {',
            '    start();',
            '/***/ }),',
            '/***/ ((module) => {',
            '    var d=4;',
            '/***/ }),',
            '/******/ })();'
        ].join('\n');
        const map: GenMapping = new GenMapping({ file: 'bundle.js' });
        const sources: [line: number, source: string][] = [
            [4, 'file:///app/node_modules/pg/lib/client.js'],
            [7, 'file:///app/node_modules/zibri/src/backup/backup.service.ts'],
            [11, 'file:///app/src/index.ts'],
            [14, 'file:///app/node_modules/@scope/package/dist/index.js']
        ];
        for (const [line, source] of sources) {
            addMapping(map, { generated: { line, column: 4 }, source, original: { line: 1, column: 0 } });
        }

        const parts: BundlePart[] = DeploymentMeasurementUtilities.resolveBundleParts(bundle, JSON.stringify(toEncodedMap(map)));

        expect(parts).toEqual([
            // its own lines alone, around the modules and between them
            { name: 'webpack and unmapped code', bytes: 156 },
            // its indentation and the line the compiler added, before the first one mapped
            { name: 'pg', bytes: 35 },
            // and the one after it
            { name: 'zibri/backup', bytes: 32 },
            { name: '@scope/package', bytes: 13 },
            { name: 'the application', bytes: 13 }
        ]);
        // every byte in exactly one part
        expect(parts.reduce((sum, part) => sum + part.bytes, 0)).toBe(Buffer.byteLength(bundle));
    });
});