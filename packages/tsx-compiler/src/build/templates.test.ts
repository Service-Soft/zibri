import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { collectClientPackagesFromFiles, findTemplateFiles } from './templates';
import { testFileFolder } from '../__testing__/constants';

// The sandbox app is the real-world corpus: it holds page, component and email templates, some of
// which import browser packages with `?client`.
const templates: string = join(__dirname, '..', '..', '..', 'sandbox', 'src', 'templates');

describe('findTemplateFiles', () => {
    it('finds the sandbox templates recursively', () => {
        const files: string[] = findTemplateFiles([join(templates, 'pages'), join(templates, 'components')]);

        expect(files.length).toBeGreaterThan(1);
        expect(files.every(f => f.endsWith('.tsx'))).toBe(true);
        // A nested page proves the walk recurses instead of only listing the top level.
        expect(files.some(f => f.endsWith(join('metrics', 'metrics.tsx')))).toBe(true);
    });

    it('ignores missing directories', () => {
        expect(findTemplateFiles([join(templates, 'does-not-exist')])).toEqual([]);
    });
});

describe('collectClientPackagesFromFiles', () => {
    it('collects the union of ?client packages across the sandbox templates', () => {
        const packages: string[] = collectClientPackagesFromFiles(
            findTemplateFiles([join(templates, 'pages'), join(templates, 'components')])
        );

        expect(packages.toSorted()).toEqual(['chart.js', 'socket.io-client']);
    });

    it('returns nothing for templates without client imports', () => {
        expect(collectClientPackagesFromFiles(findTemplateFiles([join(templates, 'emails')]))).toEqual([]);
    });

    it('collects the ?client packages a page written in mdx imports', () => {
        const dir: string = join(testFileFolder, `templates-${randomUUID()}`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'chart.mdx'), 'import { Chart } from \'chart.js?client\';\n\n# Revenue\n\n'
        + '<button onClick={() => console.log(Chart.version)}>Log</button>\n');

        expect(collectClientPackagesFromFiles(findTemplateFiles([dir]))).toEqual(['chart.js']);
    });
});