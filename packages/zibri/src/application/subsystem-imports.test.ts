import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { SourceImport } from '../__testing__/source-import.model';
import { SourceImportUtilities } from '../__testing__/source-import.utilities';

/**
 * Which way the subsystems of the framework depend on each other, read off the imports of its sources.
 *
 * A subsystem that has to hear of something another one did follows it rather than being called by it:
 * the writes it cares about through the observers of the data layer. Calling it instead means every
 * place that does the thing has to remember the call, and the one that forgets is a bug nobody sees.
 */

/**
 * The directories the data layer may import at runtime: what sits below it, and what every layer
 * stands on.
 */
const BELOW_THE_DATA_LAYER: string[] = [
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
    'utilities'
];

describe('imports between subsystems', () => {
    // 09 §Q6: auth and tenancy called the websocket service wherever a login ended or a membership
    // changed, and a login the application ended through a repository closed no socket
    it('lets nothing in auth or tenancy call the websocket service', () => {
        const importing: SourceImport[] = [...SourceImportUtilities.findSourceImports('auth'), ...SourceImportUtilities.findSourceImports('tenancy')]
            .filter(i => i.imported.startsWith(path.join('websocket', 'services')));
        // through its token, which needs no import of the interface
        const injecting: string[] = [...SourceImportUtilities.findSourceFiles('auth'), ...SourceImportUtilities.findSourceFiles('tenancy')]
            .filter(file => SourceImportUtilities.readSourceFile(file).includes('ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE'));

        expect(importing).toEqual([]);
        expect(injecting).toEqual([]);
    });

    // 09 §Q9: the data layer imported auth, tenancy, change sets, open api, backup and leases, so
    // that a cycle ran through it from every subsystem built on it
    it('lets the data layer import at runtime only what sits below it', () => {
        expect(SourceImportUtilities.findRuntimeImportsOutside(['data-source', 'entity'], BELOW_THE_DATA_LAYER)).toEqual([]);
    });
});
