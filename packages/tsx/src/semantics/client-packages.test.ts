import { describe, expect, it } from '@jest/globals';

import { collectClientPackagesFromSource } from './client-packages';
import { vendorFileName } from '../vendor-file-name';

describe('collectClientPackagesFromSource', () => {
    it('collects packages imported with ?client', () => {
        const source: string = 'import { Chart } from \'chart.js?client\';\n'
            + 'import { io } from \'socket.io-client?client\';\n'
            + 'import { Card } from \'./card\';\n'
            + 'export const A = () => <div/>;';
        expect(collectClientPackagesFromSource(source)).toEqual(['chart.js', 'socket.io-client']);
    });

    it('ignores plain imports and de-duplicates', () => {
        const source: string = 'import { A } from \'chart.js?client\';\n'
            + 'import { B } from \'chart.js?client\';\n'
            + 'export const C = () => <div/>;';
        expect(collectClientPackagesFromSource(source)).toEqual(['chart.js']);
    });

    it('returns nothing for a template without client imports', () => {
        expect(collectClientPackagesFromSource('export const A = () => <div/>;')).toEqual([]);
    });
});

describe('vendorFileName', () => {
    it.each([
        ['chart.js', 'chart-js.js'],
        ['socket.io-client', 'socket-io-client.js'],
        ['@scope/pkg', 'scope-pkg.js']
    ])('maps %s to %s', (packageName, expected) => {
        expect(vendorFileName(packageName)).toBe(expected);
    });
});