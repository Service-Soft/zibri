import { describe, expect, it } from '@jest/globals';

import { InternalError } from '../../../error-handling/internal-error.model';
import { EBilanzTaxonomyUtilities } from './e-bilanz-taxonomy.utilities';
import { type EBilanzTaxonomyPosition } from './models/e-bilanz-taxonomy-position.model';
import { type EBilanzTaxonomy } from './models/e-bilanz-taxonomy.model';
import { Hgb6EBilanzTaxonomyAdapter } from './services/hgb-6.e-bilanz-taxonomy-adapter';
import { E_BILANZ_TAXONOMIES } from './taxonomies/e-bilanz-taxonomies.model';
import { HGB_TAXONOMY_6_10 } from './taxonomies/hgb-taxonomy-6-10.model';
import { HGB_TAXONOMY_6_9 } from './taxonomies/hgb-taxonomy-6-9.model';

function day(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
}

describe('the versions of the HGB taxonomy shipped', () => {
    const adapter: Hgb6EBilanzTaxonomyAdapter = new Hgb6EBilanzTaxonomyAdapter();

    it('name every parent and every part of a sum they have, and what the adapter maps to', () => {
        expect(() => EBilanzTaxonomyUtilities.validateTaxonomies(E_BILANZ_TAXONOMIES, [adapter])).not.toThrow();
    });

    it('hold the positions, columns and fields extracted from the official zips', () => {
        // counted by the script from german-gaap-taxonomy-v6.9-2025-04-01.zip and -v6.10-2026-04-01.zip
        expect(EBilanzTaxonomyUtilities.resolvePositions(HGB_TAXONOMY_6_9).size).toBe(690);
        expect(EBilanzTaxonomyUtilities.resolvePositions(HGB_TAXONOMY_6_10).size).toBe(694);
        expect(HGB_TAXONOMY_6_9.fixedAssetColumns).toHaveLength(28);
        expect(HGB_TAXONOMY_6_9.gcdFields).toHaveLength(52);
        expect(HGB_TAXONOMY_6_10.gcdFields).toHaveLength(51);
        expect(HGB_TAXONOMY_6_10.notice).toContain('XBRL Deutschland e.V.');
    });

    it('resolve a position with its label, side, requirement and the positions it sums', () => {
        const positions: Map<string, EBilanzTaxonomyPosition> = EBilanzTaxonomyUtilities.resolvePositions(HGB_TAXONOMY_6_9);

        expect(positions.get('bs.ass.currAss.cashEquiv.bank')).toStrictEqual({
            name: 'bs.ass.currAss.cashEquiv.bank',
            statement: 'balanceSheet',
            parent: 'bs.ass.currAss.cashEquiv',
            balance: 'debit',
            requirement: 'R',
            label: 'Kassenbestand, Bundesbankguthaben, Guthaben bei Kreditinstituten und Schecks; Guthaben bei Kreditinstituten',
            sums: []
        });
        expect(positions.get('bs.ass.currAss.cashEquiv')?.sums.map(s => s.name)).toContain('bs.ass.currAss.cashEquiv.bank');
        expect(positions.get('is.netIncome')?.sums).toContainEqual({ name: 'is.netIncome.otherTaxes', weight: -1 });
    });

    // the result of the BVV has no side in the schema, and takes that of the equity at the end it adds. The capital
    // changes of a § 6b EStG reserve are not asked of a corporation
    it('resolve the steuerlicher Betriebsvermögensvergleich, its result the equity at the end less that of the year before', () => {
        for (const taxonomy of E_BILANZ_TAXONOMIES) {
            const positions: Map<string, EBilanzTaxonomyPosition> = EBilanzTaxonomyUtilities.resolvePositions(taxonomy);

            expect([...positions.values()].filter(p => p.statement === 'businessAssetComparison').map(p => [p.name, p.balance, p.requirement])).toStrictEqual([
                ['BVV.profitLoss', 'credit', 'S'],
                ['BVV.profitLoss.assetsCurrentYear', 'credit', 'M'],
                ['BVV.profitLoss.assetsPreviousYear', 'credit', 'S'],
                ['BVV.profitLoss.assetsPreviousYear.assets', 'credit', 'M'],
                ['BVV.profitLoss.assetsPreviousYear.capAdjustments', 'credit', 'M'],
                ['BVV.profitLoss.withdrawalDistrib', 'debit', 'M'],
                ['BVV.profitLoss.contribution', 'credit', 'M']
            ]);
            expect(positions.get('BVV.profitLoss')?.sums).toStrictEqual([
                { name: 'BVV.profitLoss.assetsCurrentYear', weight: 1 },
                { name: 'BVV.profitLoss.assetsPreviousYear', weight: -1 },
                { name: 'BVV.profitLoss.withdrawalDistrib', weight: 1 },
                { name: 'BVV.profitLoss.contribution', weight: -1 }
            ]);
        }
    });

    it('sum the income statement of a micro corporation from every calculation its entry point discovers', () => {
        for (const taxonomy of E_BILANZ_TAXONOMIES) {
            const positions: Map<string, EBilanzTaxonomyPosition> = EBilanzTaxonomyUtilities.resolvePositions(taxonomy);
            const netSales: string = 'is.netIncome.regular.operatingTC.grossTradingProfit.totalOutput.netSales';

            // the revenue, material and staff are summed in the calculation of the classification of the full one
            expect(positions.get('ismi.netIncome.netSales')?.sums).toStrictEqual([
                { name: 'is.netIncome.regular.operatingTC.grossTradingProfit.totalOutput.statutoryDuties', weight: 1 },
                { name: `${netSales}.grossSales`, weight: 1 },
                { name: `${netSales}.reductionsFromGrossSales`, weight: -1 }
            ]);
            expect(positions.get('ismi.netIncome.materialServices')?.sums.map(s => s.name)).toContain('is.netIncome.regular.operatingTC.grossTradingProfit.materialServices.material');
            expect(positions.get('ismi.netIncome.staff')?.sums.map(s => s.name)).toContain('is.netIncome.regular.operatingTC.staff.salaries');
        }
    });

    it('resolve the columns each column of the statement of changes in fixed assets sums, up to the book value', () => {
        const sums: Map<string, EBilanzTaxonomyPosition['sums']> = EBilanzTaxonomyUtilities.resolveFixedAssetColumnSums(HGB_TAXONOMY_6_10);

        expect(sums.get('all')).toStrictEqual([{ name: 'gross', weight: 1 }, { name: 'accDepr', weight: -1 }, { name: 'revaluation', weight: 1 }]);
        expect(sums.get('gross')?.find(s => s.name === 'gross.release')?.weight).toBe(-1);
        expect(sums.get('accDepr')?.find(s => s.name === 'accDepr.release')?.weight).toBe(-1);
        // the columns below it as its parts, and none for one whose column below it says what part of it it is
        expect(sums.get('accDepr.DeprPeriod')?.map(s => s.name)).toContain('accDepr.DeprPeriod.regular');
        expect(sums.get('gross.addition')).toStrictEqual([]);
    });

    it('map every position of the statements of the books to a position summing nothing', () => {
        for (const taxonomy of E_BILANZ_TAXONOMIES) {
            const positions: Map<string, EBilanzTaxonomyPosition> = EBilanzTaxonomyUtilities.resolvePositions(taxonomy);
            const summing: string[] = Object.values(adapter.resolveStatementPositionMapping(taxonomy)).filter(name => positions.get(name)?.sums.length !== 0);

            expect({ version: taxonomy.version, summing }).toStrictEqual({ version: taxonomy.version, summing: [] });
        }
    });

    it('state 6.10 by what it changes of 6.9', () => {
        const names: Set<string> = new Set(EBilanzTaxonomyUtilities.resolvePositions(HGB_TAXONOMY_6_10).keys());

        expect(names.has('bs.eqLiab.otherSpecRes.TEHGFreeOfCharge')).toBe(true);
        expect(names.has('bs.ass.fixAss.fin.otherFinAss.silent')).toBe(false);
        expect(() => EBilanzTaxonomyUtilities.resolveChanged(HGB_TAXONOMY_6_9, {
            ...HGB_TAXONOMY_6_10,
            statements: {
                balanceSheet: { removed: [], rows: [{ after: 'bs.unknown', row: ['bs.new', null, 'D', 'R', 'Neu'] }] },
                incomeStatement: { removed: [], rows: [] },
                microIncomeStatement: { removed: [], rows: [] },
                appropriationOfProfits: { removed: [], rows: [] },
                businessAssetComparison: { removed: [], rows: [] }
            }
        })).toThrow(InternalError);
    });

    it('pick the version a fiscal year needs to be stated in, or the one it is allowed and asked for', () => {
        expect(EBilanzTaxonomyUtilities.findTaxonomy(E_BILANZ_TAXONOMIES, day('2025-01-01'))).toBeUndefined();
        expect(EBilanzTaxonomyUtilities.findTaxonomy(E_BILANZ_TAXONOMIES, day('2026-01-01'))?.version).toBe('6.9');
        expect(EBilanzTaxonomyUtilities.findTaxonomy(E_BILANZ_TAXONOMIES, day('2027-01-01'))?.version).toBe('6.10');
        expect(EBilanzTaxonomyUtilities.findTaxonomy(E_BILANZ_TAXONOMIES, day('2027-07-01'))?.version).toBe('6.10');
        // the year of a version not shipped yet
        expect(EBilanzTaxonomyUtilities.findTaxonomy(E_BILANZ_TAXONOMIES, day('2028-01-01'))).toBeUndefined();
        expect(EBilanzTaxonomyUtilities.findTaxonomy(E_BILANZ_TAXONOMIES, day('2025-01-01'), '6.9')?.version).toBe('6.9');
        expect(EBilanzTaxonomyUtilities.findTaxonomy(E_BILANZ_TAXONOMIES, day('2026-01-01'), '6.10')?.version).toBe('6.10');
    });

    it('refuse a version twice, one whose adapter is not registered, and one summing a column it does not have', () => {
        const other: EBilanzTaxonomy = { ...HGB_TAXONOMY_6_10, version: '6.11', adapter: 'hgb-7' };

        expect(() => EBilanzTaxonomyUtilities.validateTaxonomies([HGB_TAXONOMY_6_9, HGB_TAXONOMY_6_9], [adapter])).toThrow('registered twice');
        expect(() => EBilanzTaxonomyUtilities.validateTaxonomies([other], [adapter])).toThrow('needs the adapter "hgb-7"');
        const unknownColumn: EBilanzTaxonomy = {
            ...HGB_TAXONOMY_6_10,
            fixedAssetColumns: [...HGB_TAXONOMY_6_10.fixedAssetColumns, ['gross.total', null, 'S', 'Summe', ['gross', 'gross.unknown']]]
        };
        expect(() => EBilanzTaxonomyUtilities.validateTaxonomies([unknownColumn], [adapter])).toThrow('sums gross.unknown');
    });
});