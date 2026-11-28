/* eslint-disable cspell/spellchecker */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../../di/inject.function';
import { defineProvider } from '../../../../di/models/di-provider.model';
import { type XmlContent, type XmlElementNode } from '../../../../document/xml-element-node.model';
import { XmlReaderUtilities } from '../../../../document/xml-reader.utilities';
import { InternalError } from '../../../../error-handling/internal-error.model';
import { FsUtilities } from '../../../../utilities/fs.utilities';
import { BigNumber, NumberUtilities } from '../../../../utilities/number.utilities';
import { bookkeepingTestEntities, inTenant, journal, ReceiptsFileStore, receiptsFolder } from '../../bookkeeping.cases';
import { ZibriBookkeepingPlugin } from '../../bookkeeping.plugin';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../../bookkeeping.tokens';
import { type BookkeepingStatementForms } from '../../models/bookkeeping-statement-forms.model';
import { FiscalYear } from '../../models/fiscal-year.model';
import { type NewJournalEntry } from '../../models/new-journal-entry.model';
import { type BookkeepingConformanceServiceInterface } from '../../services/conformance/bookkeeping-conformance-service.interface';
import { HGB_MICRO_BALANCE_SHEET } from '../../statements/hgb-micro-balance-sheet.model';
import { HGB_MICRO_INCOME_STATEMENT } from '../../statements/hgb-micro-income-statement.model';
import { COMPANY, createBooks, type EBilanzCaseBooks, type EBilanzCaseBooksOptions, eBilanzTestEntities, eBilanzTestProviders, FIXED_ASSETS_BOOKS, UG_LEGAL_RESERVE_BOOKS, UNIFIED } from '../e-bilanz.cases';
import { ZibriEBilanzPlugin } from '../e-bilanz.plugin';
import { EBilanzTaxonomyUtilities } from '../e-bilanz-taxonomy.utilities';
import { ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS } from '../e-bilanz.tokens';
import { EBilanzConformanceService } from './e-bilanz-conformance.service';
import { type EBilanzContent } from '../models/e-bilanz-content.model';
import { EBilanzIncomeStatementForm } from '../models/e-bilanz-income-statement-form.enum';
import { type EBilanzPreparation } from '../models/e-bilanz-preparation.model';
import { EBilanzRevisionStatus } from '../models/e-bilanz-revision-status.enum';
import { type EBilanzTaxonomyPosition } from '../models/e-bilanz-taxonomy-position.model';
import { type EBilanzTaxonomy } from '../models/e-bilanz-taxonomy.model';
import { XbrlEBilanzExporter } from './xbrl.e-bilanz-exporter';

const XBRLI: string = 'http://www.xbrl.org/2003/instance';
const LINK: string = 'http://www.xbrl.org/2003/linkbase';
const XBRLDI: string = 'http://xbrl.org/2006/xbrldi';

/**
 * The namespaces of the modules of a version, by the date of the version.
 */
type ModuleNamespaces = {
    gcd: string,
    gaap: string
};

/**
 * The instance document of an E-Bilanz, read back.
 */
type Instance = {
    xml: string,
    root: XmlElementNode,
    contexts: Map<string, XmlElementNode>,
    facts: XmlElementNode[]
};

/**
 * A conformance stating the statements of a fiscal year naming it in the forms of a micro corporation.
 */
class MicroFormsConformanceService implements BookkeepingConformanceServiceInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'test-micro-forms';

    // eslint-disable-next-line jsdoc/require-jsdoc
    isApplicable(): boolean {
        return false;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveClosingProposals(): NewJournalEntry[] {
        return [];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateClosing(): void {
        return;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveStatementForms(): BookkeepingStatementForms {
        return { balanceSheet: HGB_MICRO_BALANCE_SHEET.id, incomeStatement: HGB_MICRO_INCOME_STATEMENT.id };
    }
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        fileStores: [ReceiptsFileStore],
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, ...bookkeepingTestEntities, ...eBilanzTestEntities],
                repositories: defaultTestServerRepositories
            })
        ],
        plugins: [new ZibriBookkeepingPlugin(), new ZibriEBilanzPlugin()],
        providers: [
            ...defaultTestServerProviders,
            ...eBilanzTestProviders.filter(p => p.token !== ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.BOOKKEEPING_CONFORMANCE_SERVICES),
            defineProvider({
                token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.BOOKKEEPING_CONFORMANCE_SERVICES,
                useFactory: () => [inject(EBilanzConformanceService), new MicroFormsConformanceService()]
            })
        ]
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(receiptsFolder);
}, TestTimeouts.inMemory.shutdown);

/**
 * Prepares the E-Bilanz of the books of a case.
 * @param options - The books.
 * @param taxonomyVersion - The version it is stated in, the one the fiscal year needs by default.
 * @param revisionStatus - What it states of itself, `original` by default.
 * @returns The content, which needs nothing more.
 */
async function prepare(options: EBilanzCaseBooksOptions = {}, taxonomyVersion?: string, revisionStatus?: EBilanzRevisionStatus): Promise<EBilanzContent> {
    const books: EBilanzCaseBooks = await createBooks(options);
    const preparation: EBilanzPreparation = await inTenant(
        books.tenantId,
        async () => await inject(ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.E_BILANZ_SERVICE).resolvePreparation(books.fiscalYear.id, { ...UNIFIED, taxonomyVersion, revisionStatus })
    );
    expect(preparation.findings).toStrictEqual([]);
    return preparation.content;
}

/**
 * Writes the instance document of an E-Bilanz and reads it back, which refuses a document that is not well formed or
 * names a prefix it does not declare.
 * @param content - The E-Bilanz.
 * @returns The document.
 */
function write(content: EBilanzContent): Instance {
    const xml: string = new XbrlEBilanzExporter().resolveFile(content).toString('utf8');
    const root: XmlElementNode = XmlReaderUtilities.resolveRootElement(xml);
    const children: XmlElementNode[] = elementsOf(root);
    return {
        xml,
        root,
        contexts: new Map(children.filter(c => c.name === 'context').map(c => [c.attributes['id'] ?? '', c])),
        facts: children.filter(c => c.namespace !== XBRLI && c.namespace !== LINK)
    };
}

function elementsOf(element: XmlElementNode): XmlElementNode[] {
    return element.content.filter((c: XmlContent): c is XmlElementNode => typeof c !== 'string');
}

function textOf(element: XmlElementNode | undefined): string {
    return element?.content.filter(c => typeof c === 'string').join('') ?? '';
}

function descendantsOf(element: XmlElementNode): XmlElementNode[] {
    return elementsOf(element).flatMap(e => [e, ...descendantsOf(e)]);
}

function factOf(instance: Instance, name: string): XmlElementNode | undefined {
    return instance.facts.find(f => f.name === name);
}

function taxonomyOf(version: string): EBilanzTaxonomy {
    const taxonomy: EBilanzTaxonomy | undefined = inject(ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.TAXONOMIES).find(t => t.version === version);
    if (taxonomy == undefined) {
        throw new Error(`No taxonomy ${version}`);
    }
    return taxonomy;
}

function namespacesOf(taxonomy: EBilanzTaxonomy): ModuleNamespaces {
    return { gcd: `http://www.xbrl.de/taxonomies/de-gcd-${taxonomy.date}`, gaap: `http://www.xbrl.de/taxonomies/de-gaap-ci-${taxonomy.date}` };
}

function isNil(element: XmlElementNode | undefined): boolean {
    return element?.attributes['nil'] === 'true';
}

describe('the XBRL of the E-Bilanz', () => {
    it('is well formed and references the entry points of a tax filing of its version, read from the taxonomy package', async () => {
        const content69: EBilanzContent = await prepare();
        const content610: EBilanzContent = await prepare({}, '6.10');

        const hrefs: (instance: Instance) => string[] = instance => elementsOf(instance.root)
            .filter(e => e.namespace === LINK && e.name === 'schemaRef')
            .map(e => `${e.attributes['type']} ${e.attributes['href']}`);
        const instance69: Instance = write(content69);
        expect([instance69.root.namespace, instance69.root.name]).toStrictEqual([XBRLI, 'xbrl']);
        // the entry points of "Kerntaxonomie: Steuerlicher Abschluss (E-Bilanz)" in META-INF/taxonomyPackage.xml
        expect(hrefs(instance69)).toStrictEqual([
            'simple http://www.xbrl.de/taxonomies/de-gaap-ci-2025-04-01/de-gaap-ci-2025-04-01-shell-fiscal.xsd',
            'simple http://www.xbrl.de/taxonomies/de-gcd-2025-04-01/de-gcd-2025-04-01-shell.xsd'
        ]);
        expect(hrefs(write(content610))).toStrictEqual([
            'simple http://www.xbrl.de/taxonomies/de-gaap-ci-2026-04-01/de-gaap-ci-2026-04-01-shell-fiscal.xsd',
            'simple http://www.xbrl.de/taxonomies/de-gcd-2026-04-01/de-gcd-2026-04-01-shell.xsd'
        ]);
        // "... mit MicroBilG-GuV (§ 275 Abs. 5 HGB)"
        expect(hrefs(write({ ...content69, incomeStatementForm: EBilanzIncomeStatementForm.MICRO }))[0])
            .toBe('simple http://www.xbrl.de/taxonomies/de-gaap-ci-2025-04-01/de-gaap-ci-2025-04-01-shell-fiscal-microbilg.xsd');
        expect([...new Set(write(content610).facts.map(f => f.namespace))].sort()).toStrictEqual([
            'http://www.xbrl.de/taxonomies/de-gaap-ci-2026-04-01',
            'http://www.xbrl.de/taxonomies/de-gcd-2026-04-01'
        ]);
    });

    it('names only concepts of its version: the positions, the columns, the fields of the GCD module and the account level detail', async () => {
        for (const content of [await prepare(), await prepare(UG_LEGAL_RESERVE_BOOKS), await prepare({}, '6.10')]) {
            const taxonomy: EBilanzTaxonomy = taxonomyOf(content.taxonomyVersion);
            const { gcd, gaap } = namespacesOf(taxonomy);
            const positions: Map<string, EBilanzTaxonomyPosition> = EBilanzTaxonomyUtilities.resolvePositions(taxonomy);
            const columns: Set<string> = new Set(taxonomy.fixedAssetColumns.map(([column]) => column));
            const fields: Set<string> = new Set(taxonomy.gcdFields.map(([name]) => name));
            const instance: Instance = write(content);

            const unknown: string[] = instance.facts.flatMap(fact => {
                if (fact.namespace === gaap) {
                    const detail: boolean = fact.name === 'detailedInformation.accountBalances'
                        && elementsOf(fact).every(e => e.namespace === gaap && e.name.startsWith('detailedInformation.accountbalances.'));
                    return positions.has(fact.name) || columns.has(fact.name) || detail ? [] : [fact.name];
                }
                // a field, or the item of a choice or of a tuple of a field named after it
                const inside: (element: XmlElementNode, parent: string) => string[] = (element, parent) =>
                    element.namespace === gcd && (fields.has(element.name) || element.name.startsWith(`${parent}.`))
                        ? elementsOf(element).flatMap(e => inside(e, element.name))
                        : [element.name];
                return fact.namespace === gcd && fields.has(fact.name) ? elementsOf(fact).flatMap(e => inside(e, fact.name)) : [fact.name];
            });
            expect(unknown).toStrictEqual([]);
        }
    });

    it('references each context and unit it declares, the balance sheet on its last day and the rest for the fiscal year', async () => {
        const content: EBilanzContent = await prepare();
        const instance: Instance = write(content);
        const facts: XmlElementNode[] = instance.facts.flatMap(f => [f, ...descendantsOf(f)]);
        const referenced: Set<string> = new Set(facts.map(f => f.attributes['contextRef']).filter(ref => ref != undefined));
        const units: XmlElementNode[] = elementsOf(instance.root).filter(e => e.name === 'unit');

        expect([...referenced].sort()).toStrictEqual([...instance.contexts.keys()].sort());
        expect(units.map(u => [u.attributes['id'], textOf(elementsOf(u)[0])])).toStrictEqual([['EUR', 'iso4217:EUR']]);
        for (const context of instance.contexts.values()) {
            const [entity, period, scenario] = elementsOf(context);
            const identifier: XmlElementNode | undefined = entity == undefined ? undefined : elementsOf(entity)[0];
            expect([identifier?.attributes['scheme'], textOf(identifier)]).toStrictEqual(['http://www.rzf-nrw.de/Steuernummer', COMPANY.taxNumber]);
            const dates: string[] = period == undefined ? [] : elementsOf(period).map(e => `${e.name} ${textOf(e)}`);
            expect(dates).toStrictEqual(context.attributes['id'] === 'instant'
                ? ['instant 2026-12-31']
                : ['startDate 2026-01-01', 'endDate 2026-12-31']);
            if (scenario != undefined) {
                expect(elementsOf(scenario).map(m => [m.namespace, m.name, m.attributes['dimension'], textOf(m)])).toStrictEqual([
                    [XBRLDI, 'explicitMember', 'de-gaap-ci:dim_taxTrans', 'de-gaap-ci:dim_taxBal'],
                    [XBRLDI, 'explicitMember', 'de-gaap-ci:dim_changes.nt.ass.gross', `de-gaap-ci:${context.attributes['id']?.replace('fixed-asset-', '')}`]
                ]);
            }
        }
        // a context of each row of the statement of changes in fixed assets, the position above it as well
        expect([...instance.contexts.keys()].filter(id => id.startsWith('fixed-asset-'))).toStrictEqual([
            'fixed-asset-bs.ass.fixAss',
            'fixed-asset-bs.ass.fixAss.tan',
            'fixed-asset-bs.ass.fixAss.tan.otherEquipm',
            'fixed-asset-bs.ass.fixAss.tan.otherEquipm.misc'
        ]);
        for (const position of content.positions) {
            expect([position.name, factOf(instance, position.name)?.attributes['contextRef']])
                .toStrictEqual([position.name, position.statement === 'balanceSheet' ? 'instant' : 'duration']);
        }
        // every amount in euro
        const amounts: XmlElementNode[] = facts.filter(f => f.attributes['unitRef'] != undefined);
        expect(amounts.length).toBeGreaterThan(content.positions.length);
        expect(amounts.every(f => f.attributes['unitRef'] === 'EUR' && (isNil(f) ? f.attributes['decimals'] == undefined : f.attributes['decimals'] === '2'))).toBe(true);
        expect(instance.xml).toContain('xmlns:de-gaap-ci="http://www.xbrl.de/taxonomies/de-gaap-ci-2025-04-01"');
    });

    it('states each position the content holds, its amount to two decimals, and NIL as nil', async () => {
        const content: EBilanzContent = await prepare();
        const instance: Instance = write(content);

        expect(content.positions.some(p => p.amount == undefined)).toBe(true);
        for (const position of content.positions) {
            const fact: XmlElementNode | undefined = factOf(instance, position.name);
            expect([position.name, isNil(fact), textOf(fact)]).toStrictEqual([position.name, position.amount == undefined, position.amount?.toFixed(2) ?? '']);
        }
        expect(textOf(factOf(instance, 'bs.ass'))).toBe('33800.00');
        expect(isNil(factOf(instance, 'bs.ass.fixAss.intan.goodwill'))).toBe(true);
    });

    it('holds the sums of the taxonomy, read back from the document', async () => {
        for (const content of [await prepare(), await prepare(UG_LEGAL_RESERVE_BOOKS)]) {
            const positions: Map<string, EBilanzTaxonomyPosition> = EBilanzTaxonomyUtilities.resolvePositions(taxonomyOf(content.taxonomyVersion));
            const instance: Instance = write(content);
            const amounts: Map<string, BigNumber | null> = new Map(instance.facts
                .filter(f => positions.has(f.name))
                .map(f => [f.name, isNil(f) ? null : new BigNumber(textOf(f))]));

            const differing: string[] = [...amounts.entries()].flatMap(([name, amount]) => {
                const parts: { name: string, weight: 1 | -1 }[] = [...positions.get(name)?.sums ?? []].filter(s => amounts.get(s.name) != undefined);
                if (amount == undefined || !parts.length) {
                    return [];
                }
                const sum: BigNumber = parts.reduce((total, p) => NumberUtilities.add(total, NumberUtilities.multiply(amounts.get(p.name) ?? 0, p.weight)), new BigNumber(0));
                return sum.isEqualTo(amount) ? [] : [name];
            });
            expect(differing).toStrictEqual([]);
            expect(amounts.get('bs.ass')?.toFixed(2)).toBe(amounts.get('bs.eqLiab')?.toFixed(2));
        }
    });

    it('states every field of the GCD module, as an item, a choice or a tuple, and NIL where the books have no value', async () => {
        const content: EBilanzContent = await prepare();
        const taxonomy: EBilanzTaxonomy = taxonomyOf(content.taxonomyVersion);
        const instance: Instance = write(content);
        const named: Set<string> = new Set(instance.facts.flatMap(f => [f, ...descendantsOf(f)]).map(f => f.name));
        const choice: (name: string) => string[] = name => instance.facts.filter(f => f.name === name).flatMap(f => elementsOf(f).map(e => e.name));
        const item: (name: string) => string = name => textOf(instance.facts.flatMap(f => [f, ...descendantsOf(f)]).find(f => f.name === name));

        // the parts of the report are written as the items of the choice of its parts, and a tuple that is NIL stands for
        // the fields it holds
        const nil: string[] = instance.facts.filter(f => isNil(f)).map(f => `${f.name}.`);
        const missing: string[] = taxonomy.gcdFields.map(([name]) => name)
            .filter(name => !named.has(name) && !name.startsWith('genInfo.report.id.reportElement.reportElements.') && !nil.some(n => name.startsWith(n)));
        expect(missing).toStrictEqual([]);
        expect(choice('genInfo.report.id.reportElement')).toStrictEqual([
            'genInfo.report.id.reportElement.reportElements.B',
            'genInfo.report.id.reportElement.reportElements.GuV',
            'genInfo.report.id.reportElement.reportElements.BAL',
            'genInfo.report.id.reportElement.reportElements.KS',
            'genInfo.report.id.reportElement.reportElements.BVV'
        ]);
        expect([
            choice('genInfo.report.id.reportStatus'),
            choice('genInfo.report.id.revisionStatus'),
            choice('genInfo.report.id.statementType'),
            choice('genInfo.report.id.accountingStandard'),
            choice('genInfo.report.id.specialAccountingStandard'),
            choice('genInfo.report.id.incomeStatementFormat'),
            choice('genInfo.report.id.consolidationRange'),
            choice('genInfo.company.id.legalStatus'),
            choice('genInfo.company.id.incomeClassification')
        ]).toStrictEqual([
            ['genInfo.report.id.reportStatus.reportStatus.E'],
            ['genInfo.report.id.revisionStatus.revisionStatus.E'],
            ['genInfo.report.id.statementType.statementType.E'],
            ['genInfo.report.id.accountingStandard.accountingStandard.HAOE'],
            ['genInfo.report.id.specialAccountingStandard.K'],
            ['genInfo.report.id.incomeStatementFormat.incomeStatementFormat.GKV'],
            ['genInfo.report.id.consolidationRange.consolidationRange.EA'],
            ['genInfo.company.id.legalStatus.legalStatus.GMBH'],
            ['genInfo.company.id.incomeClassification.trade']
        ]);
        // the item chosen is empty, B.14.1 of the technical guide
        expect(textOf(elementsOf(instance.facts.find(f => f.name === 'genInfo.report.id.reportStatus') ?? instance.root)[0])).toBe('');
        expect([
            item('genInfo.company.id.name'),
            item('genInfo.company.id.idNo.type.companyId.ST13'),
            item('genInfo.company.id.idNo.type.companyId.BF4'),
            item('genInfo.company.id.location.zipCode'),
            item('genInfo.report.period.fiscalYearBegin'),
            item('genInfo.report.period.fiscalYearEnd'),
            item('genInfo.report.period.balSheetClosingDate'),
            item('genInfo.report.id.incomeStatementendswithBalProfit')
        ]).toStrictEqual(['Acme Software GmbH', '1121081508150', '1121', '10115', '2026-01-01', '2026-12-31', '2026-12-31', 'false']);
        // the country itself, "Firmensitz, Land", of the ISO code the company holds
        expect([COMPANY.address.country, item('genInfo.company.id.location.country')]).toStrictEqual(['DE', 'Deutschland']);
        expect(named.has('genInfo.company.id.location.country.isoCode')).toBe(false);
        // the tax numbers in one tuple, in the order of its schema
        expect(choice('genInfo.company.id.idNo')).toStrictEqual([
            'genInfo.company.id.idNo.type.companyId.ST13',
            'genInfo.company.id.idNo.type.companyId.STID',
            'genInfo.company.id.idNo.type.companyId.STWID',
            'genInfo.company.id.idNo.type.companyId.BF4'
        ]);
        // no special case of the determination of profits, no shareholders, no report of a partnership, and the account
        // level detail is there
        expect([
            'genInfo.company.id.entityWithTaxablePurposeBusiness',
            'genInfo.company.id.domesticBranchOfForeignCompany',
            'genInfo.company.id.shareholder',
            'genInfo.report.id.accordingTo',
            'genInfo.report.id.reportElement.reportElements.transmissionNotYetPossible',
            'genInfo.company.id.business'
        ].map(name => isNil(factOf(instance, name)))).toStrictEqual([true, true, true, true, true, false]);
    });

    it('states how an E-Bilanz corrects the one filed before as the item of the choice of its status', async () => {
        const statuses: EBilanzRevisionStatus[] = [
            EBilanzRevisionStatus.CORRECTED,
            EBilanzRevisionStatus.CHANGED,
            EBilanzRevisionStatus.CORRECTED_AND_CHANGED,
            EBilanzRevisionStatus.MORE_DETAIL,
            EBilanzRevisionStatus.OTHER_CORRECTION
        ];
        const items: string[][] = [];
        for (const status of statuses) {
            const instance: Instance = write(await prepare({}, undefined, status));
            items.push(instance.facts.filter(f => f.name === 'genInfo.report.id.revisionStatus').flatMap(f => elementsOf(f).map(e => e.name.split('.').at(-1) ?? '')));
        }

        expect(items).toStrictEqual([['B'], ['G'], ['BG'], ['I'], ['sK']]);
    });

    it('states the balance sheet profit and the appropriation of profits of a UG, and announces them', async () => {
        const instance: Instance = write(await prepare(UG_LEGAL_RESERVE_BOOKS));

        expect(instance.facts.filter(f => f.name === 'genInfo.report.id.reportElement').flatMap(f => elementsOf(f).map(e => e.name.split('.').at(-1))))
            .toStrictEqual(['B', 'GuV', 'BAL', 'EV', 'KS', 'BVV']);
        expect(textOf(factOf(instance, 'genInfo.report.id.incomeStatementendswithBalProfit'))).toBe('true');
        expect(elementsOf(factOf(instance, 'genInfo.company.id.legalStatus') ?? instance.root).map(e => e.name)).toStrictEqual(['genInfo.company.id.legalStatus.legalStatus.UG']);
        expect([
            [textOf(factOf(instance, 'bs.eqLiab.equity.profitLoss')), factOf(instance, 'bs.eqLiab.equity.profitLoss')?.attributes['contextRef']],
            [textOf(factOf(instance, 'incomeUse.gainLoss')), factOf(instance, 'incomeUse.gainLoss')?.attributes['contextRef']],
            [textOf(factOf(instance, 'incomeUse.gainLoss.additionRevenReserves.legalRes')), 'duration']
        ]).toStrictEqual([['7100.00', 'instant'], ['7100.00', 'duration'], ['2200.00', 'duration']]);
        expect(isNil(factOf(instance, 'bs.eqLiab.equity.netIncome'))).toBe(true);
    });

    it('lists the accounts of each position, with notPossible from the version 6.10 on', async () => {
        const accountsOf: (instance: Instance) => string[][] = instance => instance.facts
            .filter(f => f.name === 'detailedInformation.accountBalances')
            .map(f => elementsOf(f).map(e => `${e.name.replace('detailedInformation.accountbalances.', '')} ${textOf(e)}`));

        const instance69: Instance = write(await prepare());
        expect(accountsOf(instance69).find(a => a.includes('accountNumber 1200'))).toStrictEqual([
            'positionName de-gaap-ci:bs.ass.currAss.cashEquiv.misc',
            'accountNumber 1200',
            'accountDescription Bank',
            'amount 30800.00'
        ]);
        expect(accountsOf(instance69).map(a => a[1]))
            .toStrictEqual(['accountNumber 0420', 'accountNumber 1200', 'accountNumber 0800', 'accountNumber 0860', 'accountNumber 8400', 'accountNumber 4210']);
        expect(accountsOf(write(await prepare({}, '6.10'))).find(a => a.includes('accountNumber 1200'))?.at(-1)).toBe('notPossible false');
    });

    it('lists the account the closing books the result to under the result of the year, and from 6.10 on says there is none without one', async () => {
        const tuplesOf: (instance: Instance) => string[][] = instance => instance.facts
            .filter(f => f.name === 'detailedInformation.accountBalances' && elementsOf(f).some(e => textOf(e) === 'de-gaap-ci:bs.eqLiab.equity.netIncome'))
            .map(f => elementsOf(f).map(e => `${e.name.replace('detailedInformation.accountbalances.', '')} ${isNil(e) ? 'NIL' : textOf(e)}`));
        const content69: EBilanzContent = await prepare();
        const content610: EBilanzContent = await prepare({}, '6.10');
        // a closing naming no account, as the books of another program may have it
        const withoutAccount: (content: EBilanzContent) => EBilanzContent = content => ({
            ...content,
            positions: content.positions.map(p => p.name === 'bs.eqLiab.equity.netIncome' ? { ...p, accounts: [] } : p)
        });

        const named: string[] = ['positionName de-gaap-ci:bs.eqLiab.equity.netIncome', 'accountNumber 0860', 'accountDescription Profit carried forward', 'amount 8800.00'];
        expect(tuplesOf(write(content69))).toStrictEqual([named]);
        expect(tuplesOf(write(content610))).toStrictEqual([[...named, 'notPossible false']]);
        expect(tuplesOf(write(withoutAccount(content610)))).toStrictEqual([[
            'positionName de-gaap-ci:bs.eqLiab.equity.netIncome',
            'accountNumber NIL',
            'accountDescription NIL',
            'amount 8800.00',
            'notPossible true'
        ]]);
        // 6.9 asks for an account of a position only of each statement, and cannot say there is none
        expect(tuplesOf(write(withoutAccount(content69)))).toStrictEqual([]);
    });

    it('states the statement of changes in fixed assets as the tax balance sheet values of each position, NIL for each column asked for', async () => {
        const content: EBilanzContent = await prepare();
        const instance: Instance = write(content);
        const columns: Map<string, XmlElementNode> = new Map(instance.facts
            .filter(f => f.attributes['contextRef'] === 'fixed-asset-bs.ass.fixAss.tan.otherEquipm.misc')
            .map(f => [f.name, f]));

        expect(['grossCost.beginning', 'gross.addition', 'accDepr.beginning'].map(c => textOf(columns.get(c)))).toStrictEqual(['0.00', '3000.00', '0.00']);
        // the sums at the end of the year and the book value, that of the balance sheet
        expect(['gross', 'accDepr', 'all'].map(c => textOf(columns.get(c)))).toStrictEqual(['3000.00', '0.00', '3000.00']);
        expect(textOf(columns.get('all'))).toBe(textOf(factOf(instance, 'bs.ass.fixAss.tan.otherEquipm.misc')));
        expect([isNil(columns.get('gross.movements')), isNil(columns.get('accDepr.DeprPeriod.regular'))]).toStrictEqual([true, true]);
        // asked for by nobody
        expect(columns.has('gross.diff.currDiff')).toBe(false);
    });

    it('states a row of each position above one with accounts, up to the fixed assets, with the book value of the balance sheet', async () => {
        const instance: Instance = write(await prepare(FIXED_ASSETS_BOOKS));
        const columnsOf: (position: string) => Map<string, XmlElementNode> = position => new Map(instance.facts
            .filter(f => f.attributes['contextRef'] === `fixed-asset-${position}`)
            .map(f => [f.name, f]));

        for (const position of ['bs.ass.fixAss', 'bs.ass.fixAss.intan', 'bs.ass.fixAss.tan', 'bs.ass.fixAss.tan.otherEquipm']) {
            const columns: Map<string, XmlElementNode> = columnsOf(position);
            expect([position, textOf(columns.get('all'))]).toStrictEqual([position, textOf(factOf(instance, position))]);
            // NIL for each column asked for, as on every row
            expect([position, isNil(columns.get('gross.movements'))]).toStrictEqual([position, true]);
        }
        expect(['bs.ass.fixAss', 'bs.ass.fixAss.intan', 'bs.ass.fixAss.tan'].map(p => textOf(columnsOf(p).get('gross.addition')))).toStrictEqual(['6000.00', '1000.00', '5000.00']);
    });

    it('states the income statement of a micro corporation, its net income made of the revenue and the costs of the full one', async () => {
        const books: EBilanzCaseBooks = await createBooks({ close: false });
        const preparation: EBilanzPreparation = await inTenant(books.tenantId, async () => {
            await inject(repositoryTokenFor(FiscalYear)).updateById(books.fiscalYear.id, { conformances: ['e-bilanz', 'test-micro-forms'] });
            await journal().closeFiscalYear(books.fiscalYear.id, { resultAccountId: books.accounts.result.id });
            return await inject(ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.E_BILANZ_SERVICE).resolvePreparation(books.fiscalYear.id, UNIFIED);
        });
        const instance: Instance = write(preparation.content);

        // the result of the micro income statement equals that of the balance sheet
        expect(preparation.findings).toStrictEqual([]);
        expect(preparation.content.incomeStatementForm).toBe(EBilanzIncomeStatementForm.MICRO);
        expect(['ismi.netIncome', 'ismi.netIncome.netSales', 'ismi.netIncome.otherCost', 'bs.eqLiab.equity.netIncome'].map(name => textOf(factOf(instance, name))))
            .toStrictEqual(['8800.00', '10000.00', '1200.00', '8800.00']);
        expect(instance.facts.filter(f => f.name === 'genInfo.report.id.reportElement').flatMap(f => elementsOf(f).map(e => e.name.split('.').at(-1))))
            .toStrictEqual(['B', 'GuVMicroBilG', 'BAL', 'KS', 'BVV']);
        // the result of the BVV is that of the micro income statement
        expect(textOf(factOf(instance, 'BVV.profitLoss'))).toBe('8800.00');
    });

    it('states the steuerlicher Betriebsvermögensvergleich for the fiscal year, without an account level detail', async () => {
        for (const version of ['6.9', '6.10']) {
            const instance: Instance = write(await prepare({}, version));
            const bvv: XmlElementNode[] = instance.facts.filter(f => f.name.startsWith('BVV.'));

            // the capital paid in during the first fiscal year is a contribution, the equity before it 0
            expect(bvv.map(f => [f.name, f.attributes['contextRef'], textOf(f)])).toStrictEqual([
                ['BVV.profitLoss', 'duration', '8800.00'],
                ['BVV.profitLoss.assetsCurrentYear', 'duration', '33800.00'],
                ['BVV.profitLoss.assetsPreviousYear', 'duration', '0.00'],
                ['BVV.profitLoss.assetsPreviousYear.assets', 'duration', '0.00'],
                ['BVV.profitLoss.assetsPreviousYear.capAdjustments', 'duration', '0.00'],
                ['BVV.profitLoss.withdrawalDistrib', 'duration', '0.00'],
                ['BVV.profitLoss.contribution', 'duration', '25000.00']
            ]);
            expect(instance.facts
                .filter(f => f.name === 'detailedInformation.accountBalances')
                .map(f => textOf(elementsOf(f).find(e => e.name === 'detailedInformation.accountbalances.positionName')))
                .filter(name => name.startsWith('de-gaap-ci:BVV'))).toStrictEqual([]);
        }
    });

    it('states each shareholder in a tuple of its own, and escapes what the company is named', async () => {
        const content: EBilanzContent = await prepare({
            company: {
                ...COMPANY,
                name: 'Müller & Söhne <Software> GmbH',
                shareholders: [
                    { name: 'Ada Lovelace', taxId: '12345678901', share: '1/2' },
                    { name: 'Acme Holding GmbH', taxNumber: '1121081508151', legalStatus: 'GmbH', share: '1/2' }
                ]
            }
        });
        const instance: Instance = write(content);

        expect(instance.xml).toContain('Müller &#x26; Söhne &#x3c;Software&#x3e; GmbH');
        expect(textOf(factOf(instance, 'genInfo.company.id.name'))).toBe('Müller & Söhne <Software> GmbH');
        const shareholders: string[][] = instance.facts.filter(f => f.name === 'genInfo.company.id.shareholder').map(f => descendantsOf(f)
            .filter(e => !elementsOf(e).length)
            .map(e => `${e.name.replace('genInfo.company.id.shareholder.', '')} ${isNil(e) ? 'NIL' : textOf(e)}`));
        expect(shareholders).toStrictEqual([
            ['name Ada Lovelace', 'id NIL', 'taxnumber NIL', 'taxid 12345678901', 'WID NIL', 'legalStatus.legalStatus.NPP ', 'ShareDivideKey.numerator 1', 'ShareDivideKey.denominator 2'],
            ['name Acme Holding GmbH', 'id NIL', 'taxnumber 1121081508151', 'taxid NIL', 'WID NIL', 'legalStatus.legalStatus.KOER ', 'ShareDivideKey.numerator 1', 'ShareDivideKey.denominator 2']
        ]);
    });

    it('writes the same document for the same books', async () => {
        const content: EBilanzContent = await prepare(UG_LEGAL_RESERVE_BOOKS);
        const again: EBilanzContent = await prepare(UG_LEGAL_RESERVE_BOOKS);

        expect(new XbrlEBilanzExporter().resolveFile(content).equals(new XbrlEBilanzExporter().resolveFile(content))).toBe(true);
        // the books of another tenant, with ids of their own that the document does not name
        expect(new XbrlEBilanzExporter().resolveFile(content).equals(new XbrlEBilanzExporter().resolveFile(again))).toBe(true);
    });

    it('refuses a version that is not registered', async () => {
        const content: EBilanzContent = await prepare();

        expect(() => new XbrlEBilanzExporter().resolveFile({ ...content, taxonomyVersion: '7.0' })).toThrow(InternalError);
    });
});
