import { describe, expect, it } from '@jest/globals';

import { SourceImportUtilities } from '../source-import.utilities';

/**
 * The cycles between subsystems left after the data layer stopped importing what is built on it,
 * red while their findings are open.
 */
describe('imports between subsystems, still open', () => {
    // 09 §Q15: MetadataUtilities holds the metadata accessors of every subsystem, so everything that
    // imports utilities sits in a cycle with auth, routing, websocket, backup and open api
    it('lets utilities import at runtime none of the subsystems built on it', () => {
        expect(SourceImportUtilities.findRuntimeImportsOutside(['utilities'], [
            'context',
            'data-source',
            'di',
            'entity',
            'error-handling',
            'global',
            'localization',
            'logging',
            'parsing',
            'tracing',
            'types',
            'utilities',
            'validation',
            'versioning'
        ])).toEqual([]);
    });

    // 09 §Q16: every http error imports HttpStatus from http, which imports error-handling back
    it('lets error-handling import nothing of http at runtime', () => {
        expect(SourceImportUtilities.findRuntimeImportsOutside(['error-handling'], ['error-handling', 'types'])
            .filter(edge => edge.includes(' -> http/'))).toEqual([]);
    });
});
