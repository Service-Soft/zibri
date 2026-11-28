/* eslint-disable cspell/spellchecker */
import { inject } from '../../../../di/inject.function';
import { XmlWriterUtilities } from '../../../../document/xml-writer.utilities';
import { InternalError } from '../../../../error-handling/internal-error.model';
import { MimeType } from '../../../../http/mime-type.enum';
import { type BigNumber } from '../../../../utilities/number.utilities';
import { BookkeepingDayUtilities } from '../../bookkeeping-day.utilities';
import { EBilanzTaxonomyUtilities } from '../e-bilanz-taxonomy.utilities';
import { ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS } from '../e-bilanz.tokens';
import { type EBilanzContent } from '../models/e-bilanz-content.model';
import { type EBilanzField } from '../models/e-bilanz-field.model';
import { type EBilanzFixedAsset } from '../models/e-bilanz-fixed-asset.model';
import { EBilanzIncomeStatementForm } from '../models/e-bilanz-income-statement-form.enum';
import { type EBilanzPosition } from '../models/e-bilanz-position.model';
import { EBilanzRevisionStatus } from '../models/e-bilanz-revision-status.enum';
import { type EBilanzTaxonomyPosition } from '../models/e-bilanz-taxonomy-position.model';
import { type EBilanzTaxonomy } from '../models/e-bilanz-taxonomy.model';
import { type EBilanzExporterInterface } from './e-bilanz-exporter.interface';

/**
 * An element of the instance document: its qualified name, its attributes in the order they are written, and its text
 * or the elements inside it. An empty text is written as an empty element.
 */
type XbrlElement = {
    readonly name: string,
    readonly attributes: readonly (readonly [name: string, value: string])[],
    readonly content: string | readonly XbrlElement[]
};

/**
 * How a field of the GCD module that is a choice of the taxonomy (a tuple holding one of the items of a substitution
 * group) is written.
 */
type XbrlChoice = {
    /**
     * What the name of each item of the choice starts with, the token after it.
     */
    readonly item: string,
    /**
     * The token of each value the adapter states, or null for NIL.
     */
    readonly tokens: ReadonlyMap<string, string | null>,
    /**
     * What a value without a token is written as: itself, NIL, or an error, for a value only the adapter states.
     */
    readonly unknown: 'as-is' | 'nil' | 'error',
    /**
     * The token of a field without a value, NIL when undefined.
     */
    readonly none?: string
};

/**
 * A tuple of the GCD module whose items are fields of their own, written once for each occurrence of its fields.
 */
type XbrlTuple = {
    /**
     * The name of the tuple.
     */
    readonly name: string,
    /**
     * The fields it holds, in the order of its schema.
     */
    readonly members: readonly string[]
};

const NAMESPACES: readonly (readonly [prefix: string, namespace: string])[] = [
    ['xbrli', 'http://www.xbrl.org/2003/instance'],
    ['link', 'http://www.xbrl.org/2003/linkbase'],
    ['xlink', 'http://www.w3.org/1999/xlink'],
    ['xsi', 'http://www.w3.org/2001/XMLSchema-instance'],
    ['iso4217', 'http://www.xbrl.org/2003/iso4217'],
    ['xbrldi', 'http://xbrl.org/2006/xbrldi']
];
// where the taxonomy is referenced from, as the technical guide of the tax administration recommends (A.6)
const TAXONOMY_LOCATION: string = 'http://www.xbrl.de/taxonomies';
const GCD: string = 'de-gcd';
const GAAP: string = 'de-gaap-ci';
const DURATION: string = 'duration';
const INSTANT: string = 'instant';
const EUR: string = 'EUR';
const SHARE_DIVIDE_KEY: string = 'genInfo.company.id.shareholder.ShareDivideKey';
const COMPANY_LEGAL_STATUS: ReadonlyMap<string, string> = new Map([['GmbH', 'GMBH'], ['UG', 'UG'], ['AG', 'AG'], ['KGaA', 'KGAA'], ['SE', 'SE']]);
const REPORT_ELEMENTS: readonly string[] = ['B', 'GuV', 'GuVMicroBilG', 'BAL', 'STU', 'EB', 'EV', 'KS', 'BVV'];

/**
 * Writes the E-Bilanz as the XBRL instance document of its version of the HGB taxonomy: the GCD module with the
 * company and the report, the positions of its statements with NIL for those without an amount, the account level
 * detail (Kontennachweis) and the statement of changes in fixed assets, referencing the entry points the tax
 * administration takes. Writes the versions whose adapter is `hgb-6`. Provide it with `E_BILANZ_EXPORTER_DI_VARIANT`.
 */
export class XbrlEBilanzExporter implements EBilanzExporterInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'xbrl';
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly mimeType: MimeType = MimeType.XML;
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly fileExtension: string = 'xbrl';

    // the scheme the tax number names the company by in each context, the same in every one
    private readonly identifierScheme: string = 'http://www.rzf-nrw.de/Steuernummer';

    // the versions 6.x whose account level detail has no `notPossible`, which every later one requires
    private readonly versionsWithoutAccountNotPossible: ReadonlySet<string> = new Set(['6.9']);

    // the values the adapter of the versions 6.x states for the fields that are a choice, by the field
    private readonly choices: ReadonlyMap<string, XbrlChoice> = new Map<string, XbrlChoice>([
        ['genInfo.report.id.reportStatus', { item: 'genInfo.report.id.reportStatus.reportStatus', tokens: new Map([['final', 'E']]), unknown: 'error' }],
        // erstmalig, or how it corrects the E-Bilanz filed before
        ['genInfo.report.id.revisionStatus', {
            item: 'genInfo.report.id.revisionStatus.revisionStatus',
            tokens: new Map<string, string>([
                [EBilanzRevisionStatus.ORIGINAL, 'E'],
                [EBilanzRevisionStatus.CORRECTED, 'B'],
                [EBilanzRevisionStatus.CHANGED, 'G'],
                [EBilanzRevisionStatus.CORRECTED_AND_CHANGED, 'BG'],
                [EBilanzRevisionStatus.MORE_DETAIL, 'I'],
                [EBilanzRevisionStatus.OTHER_CORRECTION, 'sK']
            ]),
            unknown: 'error'
        }],
        // a Jahresabschluss
        ['genInfo.report.id.statementType', { item: 'genInfo.report.id.statementType.statementType', tokens: new Map([['single', 'E']]), unknown: 'error' }],
        // the Einheitsbilanz, or the tax balance sheet of deutsches Steuerrecht, B.13 of the guide
        [
            'genInfo.report.id.accountingStandard',
            { item: 'genInfo.report.id.accountingStandard.accountingStandard', tokens: new Map([['unified', 'HAOE'], ['tax', 'AO']]), unknown: 'error' }
        ],
        ['genInfo.report.id.specialAccountingStandard', { item: 'genInfo.report.id.specialAccountingStandard', tokens: new Map([['core', 'K']]), unknown: 'error' }],
        [
            'genInfo.report.id.incomeStatementFormat',
            { item: 'genInfo.report.id.incomeStatementFormat.incomeStatementFormat', tokens: new Map([['GKV', 'GKV']]), unknown: 'error' }
        ],
        // nicht konsolidiert / Einzelabschluss
        ['genInfo.report.id.consolidationRange', { item: 'genInfo.report.id.consolidationRange.consolidationRange', tokens: new Map([['single', 'EA']]), unknown: 'error' }],
        [
            'genInfo.report.id.reportElement',
            { item: 'genInfo.report.id.reportElement.reportElements', tokens: new Map(REPORT_ELEMENTS.map(e => [e, e])), unknown: 'error' }
        ],
        // the legal forms of a corporation by the names the books use, any other as the GCD module names it
        ['genInfo.company.id.legalStatus', { item: 'genInfo.company.id.legalStatus.legalStatus', tokens: COMPANY_LEGAL_STATUS, unknown: 'as-is' }],
        // a company without a special case of the determination of its profit, and no branch of a foreign one: NIL
        [
            'genInfo.company.id.entityWithTaxablePurposeBusiness',
            { item: 'genInfo.company.id.entityWithTaxablePurposeBusiness', tokens: new Map([['false', null]]), unknown: 'error' }
        ],
        [
            'genInfo.company.id.domesticBranchOfForeignCompany',
            { item: 'genInfo.company.id.domesticBranchOfForeignCompany', tokens: new Map([['false', null]]), unknown: 'error' }
        ],
        ['genInfo.company.id.incomeClassification', { item: 'genInfo.company.id.incomeClassification', tokens: new Map([['trade', 'trade']]), unknown: 'error' }],
        // a shareholder without a legal form is a person holding the share privately; a legal form of its own is a
        // corporation or a partnership, and one the module has no kind for is NIL
        [
            'genInfo.company.id.shareholder.legalStatus',
            {
                item: 'genInfo.company.id.shareholder.legalStatus.legalStatus',
                tokens: new Map([
                    ...[...COMPANY_LEGAL_STATUS.keys(), 'eG', 'e.V.'].map(form => [form, 'KOER'] as const),
                    ...['GbR', 'OHG', 'KG', 'GmbH & Co. KG', 'PartG'].map(form => [form, 'PG'] as const),
                    ...['NPP', 'NPB', 'PG', 'KOER'].map(token => [token, token] as const)
                ]),
                unknown: 'nil',
                none: 'NPP'
            }
        ]
    ]);

    // the fields written together in a tuple, at the place of the first of them
    private readonly tuples: readonly XbrlTuple[] = [
        {
            name: 'genInfo.report.id.accordingTo',
            members: ['genInfo.report.id.accordingTo.name', 'genInfo.report.id.accordingTo.idNo', 'genInfo.report.id.accordingTo.yearEnd']
        },
        {
            name: 'genInfo.company.id.idNo',
            members: [
                'genInfo.company.id.idNo.type.companyId.ST13',
                'genInfo.company.id.idNo.type.companyId.STID',
                'genInfo.company.id.idNo.type.companyId.STWID',
                'genInfo.company.id.idNo.type.companyId.BF4'
            ]
        },
        {
            name: 'genInfo.company.id.shareholder',
            members: [
                'genInfo.company.id.shareholder.name',
                'genInfo.company.id.shareholder.id',
                'genInfo.company.id.shareholder.taxnumber',
                'genInfo.company.id.shareholder.taxid',
                'genInfo.company.id.shareholder.WID',
                'genInfo.company.id.shareholder.legalStatus',
                SHARE_DIVIDE_KEY
            ]
        }
    ];

    /**
     * Writes the instance document of the E-Bilanz, in UTF-8.
     * @param eBilanz - The content prepared.
     * @returns The instance document.
     * @throws An InternalError when the version of the content is not registered or not one of the adapter `hgb-6`.
     */
    resolveFile(eBilanz: EBilanzContent): Buffer {
        const taxonomy: EBilanzTaxonomy = this.resolveTaxonomy(eBilanz.taxonomyVersion);
        const notPossible: boolean = !this.versionsWithoutAccountNotPossible.has(taxonomy.version);
        const facts: XbrlElement[] = [
            ...this.resolveGcdFacts(eBilanz.fields),
            ...eBilanz.positions.map(p => this.resolveMonetaryFact(this.gaap(p.name), p.statement === 'balanceSheet' ? INSTANT : DURATION, p.amount)),
            ...eBilanz.fixedAssets.flatMap(f => this.resolveFixedAssetFacts(f, taxonomy)),
            ...eBilanz.positions.flatMap(p => this.resolveAccountFacts(p, notPossible, EBilanzTaxonomyUtilities.resolvePositions(taxonomy).get(p.name)))
        ];
        // a context or unit no fact references is refused (B.14.7 of the guide)
        const referenced: Set<string> = new Set(facts.flatMap(f => this.findReferences(f)));
        const contexts: XbrlElement[] = this.resolveContexts(eBilanz).filter(c => referenced.has(c.attributes[0]?.[1] ?? ''));
        const units: XbrlElement[] = referenced.has(EUR)
            ? [{ name: 'xbrli:unit', attributes: [['id', EUR]], content: [{ name: 'xbrli:measure', attributes: [], content: 'iso4217:EUR' }] }]
            : [];
        const root: XbrlElement = {
            name: 'xbrli:xbrl',
            attributes: [
                ...NAMESPACES.map(([prefix, namespace]) => [`xmlns:${prefix}`, namespace] as const),
                [`xmlns:${GCD}`, `${TAXONOMY_LOCATION}/${GCD}-${taxonomy.date}`],
                [`xmlns:${GAAP}`, `${TAXONOMY_LOCATION}/${GAAP}-${taxonomy.date}`]
            ],
            content: [...this.resolveSchemaRefs(eBilanz, taxonomy), ...contexts, ...units, ...facts]
        };
        return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n${this.stringify(root, 0)}\n`, 'utf8');
    }

    /**
     * Resolves the version of the taxonomy the content is stated in.
     * @param version - The version, such as `6.9`.
     * @returns The version.
     * @throws An InternalError when it is not registered or of another structure.
     */
    private resolveTaxonomy(version: string): EBilanzTaxonomy {
        const taxonomy: EBilanzTaxonomy | undefined = inject(ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.TAXONOMIES).find(t => t.version === version);
        if (taxonomy == undefined) {
            throw new InternalError(`The E-Bilanz is stated in the taxonomy ${version}, which is not registered in ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.TAXONOMIES.`);
        }
        // the structure of the instance is that of the versions 6.x: a version of another structure, such as 7.0, needs
        // an exporter of its own
        if (taxonomy.adapter !== 'hgb-6') {
            throw new InternalError(`${this.constructor.name} writes the versions of the adapter hgb-6, and the taxonomy ${version} names ${taxonomy.adapter}.`);
        }
        return taxonomy;
    }

    /**
     * Resolves the entry points of the version the tax administration takes: the GAAP module of a tax filing, that of
     * a micro corporation for its income statement, and the GCD module.
     * @param eBilanz - The content.
     * @param taxonomy - Its version.
     * @returns The schema references.
     */
    private resolveSchemaRefs(eBilanz: EBilanzContent, taxonomy: EBilanzTaxonomy): XbrlElement[] {
        const gaap: string = eBilanz.incomeStatementForm === EBilanzIncomeStatementForm.MICRO ? 'shell-fiscal-microbilg' : 'shell-fiscal';
        return [
            `${TAXONOMY_LOCATION}/${GAAP}-${taxonomy.date}/${GAAP}-${taxonomy.date}-${gaap}.xsd`,
            `${TAXONOMY_LOCATION}/${GCD}-${taxonomy.date}/${GCD}-${taxonomy.date}-shell.xsd`
        ].map(href => ({ name: 'link:schemaRef', attributes: [['xlink:type', 'simple'], ['xlink:href', href]], content: '' }));
    }

    /**
     * Resolves the contexts: the fiscal year, its last day, and the fiscal year of each row of the statement of changes
     * in fixed assets, as the tax balance sheet values (dim_taxBal) of its position.
     * @param eBilanz - The content.
     * @returns The contexts, each with its id as its first attribute.
     */
    private resolveContexts(eBilanz: EBilanzContent): XbrlElement[] {
        const start: string = BookkeepingDayUtilities.formatDay(eBilanz.start);
        const end: string = BookkeepingDayUtilities.formatDay(eBilanz.end);
        const duration: XbrlElement[] = [
            { name: 'xbrli:startDate', attributes: [], content: start },
            { name: 'xbrli:endDate', attributes: [], content: end }
        ];
        const context: (id: string, period: XbrlElement[], members: [string, string][]) => XbrlElement = (id, period, members) => ({
            name: 'xbrli:context',
            attributes: [['id', id]],
            content: [
                {
                    name: 'xbrli:entity',
                    attributes: [],
                    content: [{ name: 'xbrli:identifier', attributes: [['scheme', this.identifierScheme]], content: eBilanz.company.taxNumber }]
                },
                { name: 'xbrli:period', attributes: [], content: period },
                ...members.length
                    ? [{
                        name: 'xbrli:scenario',
                        attributes: [],
                        content: members.map(([dimension, member]) => ({ name: 'xbrldi:explicitMember', attributes: [['dimension', dimension]] as const, content: member }))
                    }]
                    : []
            ]
        });
        return [
            context(DURATION, duration, []),
            context(INSTANT, [{ name: 'xbrli:instant', attributes: [], content: end }], []),
            // the tax balance sheet values, which the Einheitsbilanz and the tax balance sheet both state (B.14.12 of the guide)
            ...eBilanz.fixedAssets.map(f => context(this.resolveFixedAssetContextId(f.position), duration, [
                [this.gaap('dim_taxTrans'), this.gaap('dim_taxBal')],
                [this.gaap('dim_changes.nt.ass.gross'), this.gaap(f.position)]
            ]))
        ];
    }

    /**
     * Resolves the fields of the GCD module in their order, each as an item, as a choice, or with the others of its
     * tuple. The fields that are an item of a choice, such as each part of the report, are written by their choice.
     * @param fields - The fields.
     * @returns The facts.
     */
    private resolveGcdFacts(fields: readonly EBilanzField[]): XbrlElement[] {
        const byName: Map<string, EBilanzField[]> = new Map();
        for (const field of fields) {
            byName.set(field.name, [...byName.get(field.name) ?? [], field]);
        }
        const choiceItems: Set<string> = new Set([...this.choices.values()].flatMap(c => [...c.tokens.values()].map(token => `${c.item}.${token}`)));
        const written: Set<string> = new Set();
        return [...byName.entries()].flatMap(([name, occurrences]) => {
            if (written.has(name) || choiceItems.has(name)) {
                return [];
            }
            const tuple: XbrlTuple | undefined = this.tuples.find(t => t.name === name || t.members.includes(name));
            if (tuple == undefined) {
                return occurrences.map(f => this.resolveGcdFact(name, f.value));
            }
            for (const member of [tuple.name, ...tuple.members]) {
                written.add(member);
            }
            return this.resolveTupleFacts(tuple, byName);
        });
    }

    /**
     * Resolves a tuple of the GCD module once for each occurrence of its fields, NIL while none of them has a value.
     * @param tuple - The tuple.
     * @param fields - The fields by their name.
     * @returns The tuples.
     */
    private resolveTupleFacts(tuple: XbrlTuple, fields: ReadonlyMap<string, readonly EBilanzField[]>): XbrlElement[] {
        const members: string[] = tuple.members.filter(m => fields.has(m));
        const count: number = Math.max(0, ...members.flatMap(m => (fields.get(m) ?? []).filter(f => f.value != undefined).map(f => f.occurrence + 1)));
        if (count === 0) {
            return [this.resolveNil(this.gcd(tuple.name), [])];
        }
        return Array.from({ length: count }, (_, occurrence) => ({
            name: this.gcd(tuple.name),
            attributes: [],
            content: members.map(m => this.resolveGcdFact(m, fields.get(m)?.find(f => f.occurrence === occurrence)?.value ?? null))
        }));
    }

    /**
     * Resolves a field of the GCD module: a choice, the share of a shareholder, or an item.
     * @param name - The name of the field.
     * @param value - Its value, or null for NIL.
     * @returns The fact.
     */
    private resolveGcdFact(name: string, value: string | null): XbrlElement {
        const choice: XbrlChoice | undefined = this.choices.get(name);
        if (choice != undefined) {
            const token: string | null = this.resolveChoiceToken(name, choice, value);
            return token == undefined
                ? this.resolveNil(this.gcd(name), [])
                // the item chosen is empty, its name says it all (B.14.1 of the guide)
                : { name: this.gcd(name), attributes: [], content: [{ name: this.gcd(`${choice.item}.${token}`), attributes: [['contextRef', DURATION]], content: '' }] };
        }
        if (name === SHARE_DIVIDE_KEY) {
            return this.resolveShareFact(value);
        }
        return value == undefined
            ? this.resolveNil(this.gcd(name), [['contextRef', DURATION]])
            : { name: this.gcd(name), attributes: [['contextRef', DURATION]], content: value };
    }

    /**
     * Resolves the token of the value of a choice.
     * @param name - The name of the field.
     * @param choice - The choice.
     * @param value - The value, or null for none.
     * @returns The token, or null for NIL.
     * @throws An InternalError for a value only the adapter states that the choice has no token of.
     */
    private resolveChoiceToken(name: string, choice: XbrlChoice, value: string | null): string | null {
        if (value == undefined) {
            return choice.none ?? null;
        }
        const token: string | null | undefined = choice.tokens.get(value);
        if (token !== undefined) {
            return token;
        }
        switch (choice.unknown) {
            case 'as-is': {
                return value;
            }
            case 'nil': {
                return null;
            }
            case 'error': {
                throw new InternalError(`${this.constructor.name} has no element for the value ${value} of the field ${name}.`);
            }
        }
    }

    /**
     * Resolves the share of a shareholder, such as `1/2`, as its numerator and denominator. A share of another form
     * is NIL.
     * @param value - The share, or null.
     * @returns The tuple of the share.
     */
    private resolveShareFact(value: string | null): XbrlElement {
        const match: RegExpExecArray | null = /^(\d{1,16})\/(\d{1,16})$/.exec(value ?? '');
        if (match == undefined) {
            return this.resolveNil(this.gcd(SHARE_DIVIDE_KEY), []);
        }
        return {
            name: this.gcd(SHARE_DIVIDE_KEY),
            attributes: [],
            content: [
                { name: this.gcd(`${SHARE_DIVIDE_KEY}.numerator`), attributes: [['contextRef', DURATION]], content: match[1] ?? '' },
                { name: this.gcd(`${SHARE_DIVIDE_KEY}.denominator`), attributes: [['contextRef', DURATION]], content: match[2] ?? '' }
            ]
        };
    }

    /**
     * Resolves the values of a row of the statement of changes in fixed assets: each with an amount, and NIL for each
     * column the tax administration asks for without one.
     * @param asset - The row.
     * @param taxonomy - The version.
     * @returns The facts.
     */
    private resolveFixedAssetFacts(asset: EBilanzFixedAsset, taxonomy: EBilanzTaxonomy): XbrlElement[] {
        const asked: Set<string> = new Set(taxonomy.fixedAssetColumns.filter(([, , requirement]) => requirement === 'M' || requirement === 'S').map(([column]) => column));
        const context: string = this.resolveFixedAssetContextId(asset.position);
        return asset.values
            .filter(v => v.amount != undefined || asked.has(v.column))
            .map(v => this.resolveMonetaryFact(this.gaap(v.column), context, v.amount));
    }

    /**
     * Resolves the account level detail of a position: a tuple for each account, with the position, the number, the
     * name and the balance of the account. A position of the balance sheet or the income statement with an amount and
     * neither an account nor a position below it, such as the result of the year of a closing naming no account, gets
     * one tuple saying it has no account, in a version that can say so.
     * @param position - The position.
     * @param notPossible - Whether the version states that an account is there (`notPossible`).
     * @param taxonomyPosition - The position of the taxonomy, or undefined for none.
     * @returns The tuples.
     */
    private resolveAccountFacts(position: EBilanzPosition, notPossible: boolean, taxonomyPosition: EBilanzTaxonomyPosition | undefined): XbrlElement[] {
        const item: (name: string, content: string) => XbrlElement = (name, content) => ({
            name: this.gaap(`detailedInformation.accountbalances.${name}`),
            attributes: [['contextRef', DURATION]],
            content
        });
        // every such position needs a tuple from 6.10 on, and one without an account is the exception the guide allows,
        // with the number and the name NIL (B.12.1). 6.9 asks none of it, and has no notPossible to say so. The guide asks
        // it of the balance sheet and the income statement alone, not of the appropriation of profits or the BVV
        if (notPossible && !position.accounts.length && position.amount != undefined && taxonomyPosition?.sums.length === 0
            && position.statement !== 'appropriationOfProfits' && position.statement !== 'businessAssetComparison') {
            return [{
                name: this.gaap('detailedInformation.accountBalances'),
                attributes: [],
                content: [
                    item('positionName', this.gaap(position.name)),
                    this.resolveNil(this.gaap('detailedInformation.accountbalances.accountNumber'), [['contextRef', DURATION]]),
                    this.resolveNil(this.gaap('detailedInformation.accountbalances.accountDescription'), [['contextRef', DURATION]]),
                    this.resolveMonetaryFact(this.gaap('detailedInformation.accountbalances.amount'), DURATION, position.amount),
                    item('notPossible', 'true')
                ]
            }];
        }
        return position.accounts.map(account => ({
            name: this.gaap('detailedInformation.accountBalances'),
            attributes: [],
            content: [
                item('positionName', this.gaap(position.name)),
                item('accountNumber', account.number),
                item('accountDescription', account.name),
                this.resolveMonetaryFact(this.gaap('detailedInformation.accountbalances.amount'), DURATION, account.balance),
                ...notPossible ? [item('notPossible', 'false')] : []
            ]
        }));
    }

    /**
     * Resolves an amount in euro to two decimals, or NIL.
     * @param name - The qualified name of the concept.
     * @param context - The id of its context.
     * @param amount - The amount, or null for NIL.
     * @returns The fact.
     */
    private resolveMonetaryFact(name: string, context: string, amount: BigNumber | null): XbrlElement {
        if (amount == undefined) {
            // a NIL item has no decimals, XBRL 2.1 4.6.3
            return this.resolveNil(name, [['contextRef', context], ['unitRef', EUR]]);
        }
        return { name, attributes: [['contextRef', context], ['unitRef', EUR], ['decimals', '2']], content: amount.toFixed(2) };
    }

    private resolveNil(name: string, attributes: readonly (readonly [string, string])[]): XbrlElement {
        return { name, attributes: [...attributes, ['xsi:nil', 'true']], content: '' };
    }

    private resolveFixedAssetContextId(position: string): string {
        return `fixed-asset-${position}`;
    }

    private findReferences(element: XbrlElement): string[] {
        const own: string[] = element.attributes.filter(([name]) => name === 'contextRef' || name === 'unitRef').map(([, value]) => value);
        return typeof element.content === 'string' ? own : [...own, ...element.content.flatMap(e => this.findReferences(e))];
    }

    private gcd(name: string): string {
        return `${GCD}:${name}`;
    }

    private gaap(name: string): string {
        return `${GAAP}:${name}`;
    }

    /**
     * Writes an element, each element inside another on a line of its own, indented by two spaces.
     * @param element - The element.
     * @param depth - How deep it is.
     * @returns The element as xml.
     */
    private stringify(element: XbrlElement, depth: number): string {
        const indentation: string = '  '.repeat(depth);
        const attributes: string = element.attributes.map(([name, value]) => ` ${name}="${XmlWriterUtilities.escapeAttributeValue(value)}"`).join('');
        if (!element.content.length) {
            return `${indentation}<${element.name}${attributes}/>`;
        }
        if (typeof element.content === 'string') {
            return `${indentation}<${element.name}${attributes}>${XmlWriterUtilities.escapeText(element.content)}</${element.name}>`;
        }
        const children: string = element.content.map(child => this.stringify(child, depth + 1)).join('\n');
        return `${indentation}<${element.name}${attributes}>\n${children}\n${indentation}</${element.name}>`;
    }
}
