import { decodedMappings, SourceMapSegment, TraceMap } from '@jridgewell/trace-mapping';

import { FsUtilities } from '../encapsulation';
import { Path } from '../utilities';
import { BundlePart } from './bundle-part.model';
import { DeploymentMeasurement } from './deployment-measurement.model';

/**
 * How much larger or slower than its baseline a measurement may be before the report says so. A
 * size moves only when something is added, so the margin is narrower than the one timings get.
 */
const GROWN_FROM_RATIO: number = 1.25;

/**
 * The part of a bundle no source map names: webpack's own code around the modules, and the lines between them.
 */
const UNMAPPED_PART: string = 'webpack and unmapped code';

/**
 * The part of a bundle that is the application's own code, outside of node_modules.
 */
const APPLICATION_PART: string = 'the application';

/**
 * The folders of a package of the framework that lead to its own folders rather than naming one.
 */
const FRAMEWORK_BUILD_FOLDERS: Set<string> = new Set(['src', 'dist', 'cjs', 'esm']);

/**
 * A measurement next to the one it is compared with.
 */
type DeploymentComparison = {
    /**
     * What this run measured.
     */
    measurement: DeploymentMeasurement,
    /**
     * What the baseline recorded for the same measurement, if it has one.
     */
    baseline: DeploymentMeasurement | undefined
};

/**
 * Compares what a built deployment measures with a recorded baseline.
 *
 * What it reports is never a failure: an image is built on one machine and started on another, and
 * a threshold that fails a run is either loose enough to catch nothing or tight enough to fail at
 * random. The report is what a release is read against.
 */
export abstract class DeploymentMeasurementUtilities {
    /**
     * Writes the measurements to the report, and to the baseline when asked to.
     * @param measurements - The measurements of this run.
     * @param reportPath - Where this run's report is written.
     * @param baselinePath - The recorded baseline, which is replaced by this run when `updateBaseline` is set.
     * @param updateBaseline - Whether this run becomes the baseline.
     * @returns The report as text, each measurement next to its baseline.
     */
    static async resolveReport(
        measurements: DeploymentMeasurement[],
        reportPath: Path,
        baselinePath: Path,
        updateBaseline: boolean
    ): Promise<string> {
        const baseline: DeploymentMeasurement[] = await FsUtilities.exists(baselinePath)
            ? JSON.parse(await FsUtilities.readFile(baselinePath)) as DeploymentMeasurement[]
            : [];
        const comparisons: DeploymentComparison[] = measurements.map(measurement => ({
            measurement,
            baseline: baseline.find(b => b.name === measurement.name)
        }));

        await this.writeFile(reportPath, JSON.stringify(comparisons, undefined, 4));
        if (updateBaseline) {
            await this.writeFile(baselinePath, JSON.stringify(measurements, undefined, 4));
        }
        return this.resolveTable(comparisons);
    }

    /**
     * What a bundle is made of, read off the source map beside it: the bytes each package takes, those of a package of
     * the framework by its folders, the application's own as one part, and webpack's own lines and modules no source
     * names as another. The parts add up to the whole bundle.
     *
     * A module counts whole for its source: its indentation and the lines the compiler of the source added, which map
     * to nothing in it, as well. A module is what lies between two lines of webpack's own, which a bundle that is not
     * minified starts with `/***`.
     * @param bundle - The bundle.
     * @param sourceMap - Its source map.
     * @returns The parts, the largest first.
     */
    static resolveBundleParts(bundle: string, sourceMap: string): BundlePart[] {
        const traced: TraceMap = new TraceMap(sourceMap);
        const segmentsByLine: readonly SourceMapSegment[][] = decodedMappings(traced);
        const bytesByPart: Map<string, number> = new Map();
        const add: (part: string, bytes: number) => void = (part, bytes) => {
            bytesByPart.set(part, (bytesByPart.get(part) ?? 0) + bytes);
        };
        // the part of the module being read, once a mapping of it named one, and its bytes read before that
        let modulePart: string | undefined;
        let unnamedBytes: number = 0;
        const endModule: () => void = () => {
            add(modulePart ?? UNMAPPED_PART, unnamedBytes);
            modulePart = undefined;
            unnamedBytes = 0;
        };
        const lines: string[] = bundle.split('\n');
        for (const [index, line] of lines.entries()) {
            const lineBytes: number = Buffer.byteLength(line) + (index < lines.length - 1 ? 1 : 0);
            if (line.startsWith('/***')) {
                endModule();
                add(UNMAPPED_PART, lineBytes);
                continue;
            }
            const segments: SourceMapSegment[] = segmentsByLine[index] ?? [];
            const mapped: SourceMapSegment | undefined = segments.find(segment => segment.length !== 1);
            if (modulePart == undefined && mapped != undefined) {
                modulePart = this.resolvePart(traced.sources[mapped[1]]);
            }
            if (modulePart == undefined) {
                unnamedBytes += lineBytes;
                continue;
            }
            add(modulePart, lineBytes);
        }
        endModule();
        return [...bytesByPart]
            .filter(([, bytes]) => bytes > 0)
            .map(([name, bytes]) => ({ name, bytes }))
            .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
    }

    /**
     * Which part of a bundle a source of its map belongs to.
     * @param source - The source, as the map names it.
     * @returns The part.
     */
    private static resolvePart(source: string | null | undefined): string {
        if (source == undefined) {
            return UNMAPPED_PART;
        }
        const normalized: string = source.replaceAll('\\', '/');
        const index: number = normalized.lastIndexOf('node_modules/');
        if (index === -1) {
            return APPLICATION_PART;
        }
        const segments: string[] = normalized.slice(index + 'node_modules/'.length).split('/');
        const nameLength: number = (segments[0] ?? '').startsWith('@') ? 2 : 1;
        const name: string = segments.slice(0, nameLength).join('/');
        if (name !== 'zibri' && !name.startsWith('zibri-')) {
            return name;
        }
        // the framework's own by their folder, as most of a bundle is the framework, and a part that grew is then
        // named by what grew in it
        const below: string[] = segments.slice(nameLength);
        const firstOwn: number = below.findIndex(segment => !FRAMEWORK_BUILD_FOLDERS.has(segment));
        const own: string[] = firstOwn === -1 ? [] : below.slice(firstOwn);
        return own.length > 1 ? `${name}/${own[0]}` : name;
    }

    private static async writeFile(path: Path, content: string): Promise<void> {
        if (await FsUtilities.exists(path)) {
            await FsUtilities.updateFile(path, content, 'replace', false);
            return;
        }
        await FsUtilities.createFile(path, content, true, false);
    }

    private static resolveTable(comparisons: DeploymentComparison[]): string {
        const rows: string[] = comparisons.map(({ measurement, baseline }) => {
            const ratio: number | undefined = baseline == undefined ? undefined : measurement.value / baseline.value;
            const grown: string = measurement.unit === 'bytes' ? 'larger' : 'slower';
            const verdict: string = ratio == undefined
                ? 'no baseline'
                : ratio >= GROWN_FROM_RATIO ? `${ratio.toFixed(2)}x, ${grown}` : `${ratio.toFixed(2)}x`;
            return [
                measurement.name.padEnd(40),
                this.format(measurement).padStart(14),
                (baseline == undefined ? '-' : this.format(baseline)).padStart(14),
                `  ${verdict}`
            ].join('');
        });
        const heading: string = ['measurement'.padEnd(40), 'this run'.padStart(14), 'baseline'.padStart(14), '  against it'].join('');
        return [heading, ...rows].join('\n');
    }

    private static format(measurement: DeploymentMeasurement): string {
        return measurement.unit === 'bytes'
            ? `${(measurement.value / 1_000_000).toFixed(1)} MB`
            : `${(measurement.value / 1000).toFixed(1)} s`;
    }
}