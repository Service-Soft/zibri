import { describe, expect, it } from '@jest/globals';

import { collectRegions, RegionCollection } from './regions';
import { parseTemplateOk } from '../../__testing__/parse.helper';
import { ComponentFunction, findComponents } from '../../semantics/component';

describe('collectRegions', () => {
    // every pass of a compile reads the regions, and walking the markup of a large page once for each was most of what
    // building a site of pages written in markdown took
    it('collects the regions of a component once, however many passes read them', () => {
        const fn: ComponentFunction = findComponents(parseTemplateOk(
            'const A = () => { const open = useState(false); return <div>{open.value && <p>Open</p>}</div>; };'
        ))[0].fn;
        const first: RegionCollection = collectRegions(fn);

        expect(first.sites).toHaveLength(1);
        expect(collectRegions(fn)).toBe(first);
    });
});