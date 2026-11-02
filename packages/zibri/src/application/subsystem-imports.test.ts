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
    // auth and tenancy called the websocket service wherever a login ended or a membership
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

    // the data layer imported auth, tenancy, change sets, open api, backup and leases, so
    // that a cycle ran through it from every subsystem built on it
    it('lets the data layer import at runtime only what sits below it', () => {
        expect(SourceImportUtilities.findRuntimeImportsOutside(['data-source', 'entity'], BELOW_THE_DATA_LAYER)).toEqual([]);
    });

    // MetadataUtilities imported the metadata shapes of auth, routing, websocket, backup and
    // open api as values, so everything importing utilities sat in a cycle with all of them
    it('lets utilities import at runtime none of the subsystems built on it', () => {
        expect(SourceImportUtilities.findRuntimeImportsOutside(['utilities'], [...BELOW_THE_DATA_LAYER, 'validation', 'versioning'])).toEqual([]);
    });

    // error-handling and http import each other. The errors need the status, header and mime
    // type enums of http, and a file that imports nothing at runtime cannot be part of a cycle, so
    // those are what error-handling may take from http
    it('lets error-handling import at runtime only files of http that import nothing themselves', () => {
        const intoHttp: SourceImport[] = SourceImportUtilities.findSourceImports('error-handling')
            .filter(i => !i.isTypeOnly && SourceImportUtilities.findTopLevelDir(i.imported) === 'http');
        const notLeaves: string[] = intoHttp
            .filter(i => SourceImportUtilities.findFileImports(`${i.imported}.ts`).some(own => !own.isTypeOnly))
            .map(i => `${i.file} -> ${i.imported}`);

        expect(notLeaves).toEqual([]);
    });
});