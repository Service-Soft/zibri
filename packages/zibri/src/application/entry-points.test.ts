import { describe, expect, it } from '@jest/globals';

import { EntryPointUtilities, ExportedName } from '../__testing__/entry-point.utilities';

/**
 * Whether `zibri` and `zibri/internal` together pass on everything the files behind them export.
 *
 * A file whose names are split between the two is re-exported by name rather than with `export *`,
 * so a name added to it later reaches neither entry point until somebody lists it. This is what
 * notices: such a name has to be put on one of them, `zibri` with a Key exports row or
 * `zibri/internal`.
 */

describe('the entry points', () => {

    it('pass on every name the files behind them export, each on exactly one of them', () => {
        const main: Set<string> = new Set(EntryPointUtilities.resolveNames('index.ts').map(exported => exported.name));
        const internal: Set<string> = new Set(EntryPointUtilities.resolveNames('internal.ts').map(exported => exported.name));
        const declared: ExportedName[] = [
            ...EntryPointUtilities.resolveReexportedFileNames('index.ts'),
            ...EntryPointUtilities.resolveReexportedFileNames('internal.ts')
        ];

        const onBoth: string[] = [...main].filter(name => internal.has(name));
        const onNeither: string[] = declared
            .filter(exported => !main.has(exported.name) && !internal.has(exported.name))
            .map(exported => `${exported.name} (${exported.file})`);

        // not vacuous: the files behind the two entry points declare well over a thousand names
        expect(declared.length).toBeGreaterThan(1000);
        expect({ onBoth, onNeither }).toEqual({ onBoth: [], onNeither: [] });
    }, 120_000);

    // 08 §X21: a developer guesses a name they have not read only when every subsystem spells it the
    // same way, so a duration says `InMs`, a point in time `AtMs`, and nothing leaves the unit out;
    // the few durations in seconds (09 §Q11) say `InSeconds`
    it('name every duration and every point in time with its unit', () => {
        const unitless: RegExp = /(Ms|MS|Seconds|SECONDS|(^|[_a-z])(ttl|Ttl|TTL|timeout|Timeout|TIMEOUT))$/;
        const withUnit: RegExp = /(InMs|AtMs|InSeconds|_IN_MS|_AT_MS|_IN_SECONDS)$/;
        // the options a browser is handed for a passkey, named by the WebAuthn specification
        const namedByAStandard: string[] = [
            'auth/authenticators/passkey/passkey-creation-options.model.ts',
            'auth/authenticators/passkey/passkey-request-options.model.ts'
        ];
        const names: ExportedName[] = EntryPointUtilities.resolveMemberNames('index.ts');
        const wrong: string[] = [
            ...new Set(names
                .filter(exported => !namedByAStandard.includes(exported.file))
                .filter(exported => unitless.test(exported.name) && !withUnit.test(exported.name))
                .map(exported => `${exported.name} (${exported.file})`))
        ]
            .sort();

        // not vacuous: the public signatures name well over a hundred durations
        expect(names.filter(exported => withUnit.test(exported.name)).length).toBeGreaterThan(100);
        expect(wrong).toEqual([]);
    }, 120_000);

    it('name a page by its limit and offset, as the http query does', () => {
        const names: ExportedName[] = EntryPointUtilities.resolveMemberNames('index.ts');
        const findAllOptions: string[] = names
            .filter(exported => exported.file === 'data-source/models/options/find-all-options.model.ts')
            .map(exported => exported.name);
        // `skip` on its own is the auth decorators' word for leaving a route's auth out
        const wrong: string[] = [
            ...new Set(names
                .filter(exported => exported.name === 'take' || (exported.name === 'skip' && exported.file.startsWith('data-source/')))
                .map(exported => `${exported.name} (${exported.file})`))
        ]
            .sort();

        expect(findAllOptions).toEqual(expect.arrayContaining(['limit', 'offset']));
        expect(wrong).toEqual([]);
    }, 120_000);
});