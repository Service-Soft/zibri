import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { EntryPointUtilities, ExportedName, PLUGIN_ENTRY_POINTS, PUBLIC_ENTRY_POINTS } from '../__testing__/entry-point.utilities';
import { JsonUtilities } from '../utilities/json.utilities';

/**
 * What typedoc.json says typedoc documents.
 */
type TypedocEntryPoints = {
    /**
     * The entry points, relative to the package, in the order typedoc reads them.
     */
    entryPoints: string[]
};

/**
 * Whether `zibri`, `zibri/internal` and the entry points of the plugins together pass on everything the files behind
 * them export.
 *
 * A file whose names are split between two of them is re-exported by name rather than with `export *`, so a name added
 * to it later reaches none of them until somebody lists it. This is what notices: such a name has to be put on one of
 * them, a public one with a Key exports row or `zibri/internal`.
 */

/**
 * What 3.2 exported from `zibri` of the plugins that `zibri/plugin/<name>` exports since.
 */
// TODO 4.0: remove with the forwarded names
const PLUGIN_NAMES_OF_3_2: readonly string[] = [
    'AllowedCancellationMethods',
    'AllowedRefundMethods',
    'AllowedReservationMethods',
    'AmountUnit',
    'AnyPaymentProviderInterface',
    'CompanyInfo',
    'CompanyInfoServiceInterface',
    'DefaultPaymentProviderArray',
    'EN16931ConformanceService',
    'EN16931DocumentContextId',
    'ElectronicAddress',
    'Invoice',
    'InvoiceAddress',
    'InvoiceCalcService',
    'InvoiceCalcServiceInterface',
    'InvoiceConformance',
    'InvoiceConformanceServiceInterface',
    'InvoiceItem',
    'InvoiceNumberService',
    'InvoiceNumberServiceInterface',
    'InvoicePdfService',
    'InvoicePdfServiceInterface',
    'InvoiceRecipientAbbreviation',
    'InvoicingOptions',
    'InvoicingOptionsInput',
    'KnownPaymentMethod',
    'MailingList',
    'MailingListBaseEmailTemplate',
    'MailingListBaseEmailTemplateProps',
    'MailingListController',
    'MailingListPreferencesPageTemplate',
    'MailingListPreferencesPageTemplateProps',
    'MailingListQueueEmailData',
    'MailingListService',
    'MailingListServiceInterface',
    'MailingListSubscribeConfirmationEmailTemplate',
    'MailingListSubscribeConfirmationEmailTemplateProps',
    'MailingListSubscribeSuccessPageTemplate',
    'MailingListSubscribeSuccessPageTemplateProps',
    'MailingListSubscriber',
    'MailingListSubscriberCreateData',
    'MailingListSubscriptionConfirmationToken',
    'MailingListTemplateData',
    'MailingListUnsubscribeConfirmationPageTemplate',
    'MailingListUnsubscribeConfirmationPageTemplateProps',
    'MethodsCoveredByProviders',
    'NumberInvoices',
    'PayPalEnv',
    'PayPalPaymentData',
    'PayPalPaymentProvider',
    'PayPalPaymentProviderOptions',
    'PayPalPaymentProviderPaymentData',
    'PayPalValidatedPaymentData',
    'Payment',
    'PaymentDataForMethod',
    'PaymentForMethod',
    'PaymentMethod',
    'PaymentPluginOptions',
    'PaymentPluginOptionsInput',
    'PaymentProviderInterface',
    'PaymentReconciliationCronJob',
    'PaymentReservationForMethod',
    'PaymentService',
    'PaymentServiceInterface',
    'PaymentStatus',
    'PeppolConformanceService',
    'UpdateMailingListPreferences',
    'ValidatedPaymentDataForMethod',
    'Vat',
    'VatCategoryCode',
    'XRechnungConformanceService',
    'ZIBRI_INVOICING_PLUGIN_DI_TOKENS',
    'ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS',
    'ZIBRI_PAYMENT_PLUGIN_DI_TOKENS',
    'ZibriInvoicingPlugin',
    'ZibriMailingListPlugin',
    'ZibriPaymentPlugin'
];

describe('the entry points', () => {
    const entryPoints: string[] = ['index.ts', 'internal.ts', ...PLUGIN_ENTRY_POINTS];

    it('pass on every name the files behind them export, each on exactly one of them', () => {
        const names: Map<string, Set<string>> = new Map(entryPoints.map(entryPoint => [
            entryPoint,
            new Set(EntryPointUtilities.resolveNames(entryPoint).map(exported => exported.name))
        ]));
        // a name that moved stays where it was as well, deprecated, until the next major: from `zibri/internal` to
        // `zibri`, and from `zibri` to the entry point of its plugin
        const kept: Map<string, Set<string>> = new Map(entryPoints.map(entryPoint => [
            entryPoint,
            new Set(EntryPointUtilities.resolveDeprecatedNames(entryPoint))
        ]));
        const declared: ExportedName[] = entryPoints.flatMap(entryPoint => EntryPointUtilities.resolveReexportedFileNames(entryPoint));

        const onSeveral: string[] = [...new Set(declared.map(exported => exported.name))]
            .map(name => ({ name, on: entryPoints.filter(entryPoint => names.get(entryPoint)?.has(name) === true && kept.get(entryPoint)?.has(name) !== true) }))
            .filter(found => found.on.length > 1)
            .map(found => `${found.name} (${found.on.join(', ')})`);
        const onNone: string[] = declared
            .filter(exported => !entryPoints.some(entryPoint => names.get(entryPoint)?.has(exported.name) === true))
            .map(exported => `${exported.name} (${exported.file})`);
        const keptButNotMoved: string[] = [...kept.get('index.ts') ?? []]
            .filter(name => !PLUGIN_ENTRY_POINTS.some(entryPoint => names.get(entryPoint)?.has(name) === true));

        // not vacuous: the files behind the entry points declare well over a thousand names, and every plugin has some
        expect(declared.length).toBeGreaterThan(1000);
        expect(PLUGIN_ENTRY_POINTS.filter(entryPoint => (names.get(entryPoint)?.size ?? 0) === 0)).toEqual([]);
        expect({ onSeveral, onNone, keptButNotMoved }).toEqual({ onSeveral: [], onNone: [], keptButNotMoved: [] });
    }, 120_000);

    it('are each documented, the plugins before zibri, which owns what the first of them exports', () => {
        const typedoc: TypedocEntryPoints = JsonUtilities.parse(readFileSync(path.join(__dirname, '..', '..', 'typedoc.json'), 'utf8'));
        // typedoc documents a name under the first entry point it reads it on, and a plugin's name `zibri` keeps
        // until the next major belongs to the plugin
        expect(typedoc.entryPoints).toEqual([...[...PLUGIN_ENTRY_POINTS].sort(), 'index.ts'].map(entryPoint => `src/${entryPoint}`));
    });

    // TODO 4.0: remove with the forwarded names
    it('keep on zibri what 3.2 exported there of its plugins, deprecated, and nothing a plugin added since', () => {
        expect(EntryPointUtilities.resolveDeprecatedNames('index.ts').sort()).toEqual([...PLUGIN_NAMES_OF_3_2].sort());
    }, 120_000);

    // a developer guesses a name they have not read only when every subsystem spells it the same way,
    // so a duration says `InMs`, a point in time `AtMs`, and nothing leaves the unit out; the few
    // durations in seconds say `InSeconds`
    it('name every duration and every point in time with its unit', () => {
        const unitless: RegExp = /(Ms|MS|Seconds|SECONDS|(^|[_a-z])(ttl|Ttl|TTL|timeout|Timeout|TIMEOUT))$/;
        const withUnit: RegExp = /(InMs|AtMs|InSeconds|_IN_MS|_AT_MS|_IN_SECONDS)$/;
        // the options a browser is handed for a passkey, named by the WebAuthn specification
        const namedByAStandard: string[] = [
            'auth/authenticators/passkey/passkey-creation-options.model.ts',
            'auth/authenticators/passkey/passkey-request-options.model.ts'
        ];
        const names: ExportedName[] = PUBLIC_ENTRY_POINTS.flatMap(entryPoint => EntryPointUtilities.resolveMemberNames(entryPoint));
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
        const names: ExportedName[] = PUBLIC_ENTRY_POINTS.flatMap(entryPoint => EntryPointUtilities.resolveMemberNames(entryPoint));
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