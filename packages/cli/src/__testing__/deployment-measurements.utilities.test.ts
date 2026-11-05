import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { DeploymentMeasurement } from './deployment-measurement.model';
import { DeploymentMeasurementUtilities } from './deployment-measurements.utilities';
import { emptyWorkDirectory } from './empty-work-directory.function';
import { FsUtilities } from '../encapsulation';
import { Path } from '../utilities';

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
});