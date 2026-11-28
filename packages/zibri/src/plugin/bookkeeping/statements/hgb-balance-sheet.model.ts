/* eslint-disable cspell/spellchecker */
import { $t } from '../../../localization/translate.function';
import { type BookkeepingStatementStructure } from '../models/bookkeeping-statement-structure.model';
import { BookkeepingStatementType } from '../models/bookkeeping-statement-type.enum';

/**
 * The full balance sheet of a corporation, § 266 (2) and (3) HGB: the assets and, below them, the equity and
 * liabilities. The id of a position is the side, `assets` or `equity-and-liabilities`, followed by the numbering of
 * the HGB, such as `assets.B.II.1` for the trade receivables. Accounts are mapped to the positions without positions
 * below them. The result of the fiscal year is part of `equity-and-liabilities.A.V`.
 */
// the labels are the wording of the HGB, in German in de.xlf. The remarks of the HGB ("davon ...") are left out of
// them: each would be an amount of its own
export const HGB_BALANCE_SHEET: BookkeepingStatementStructure = {
    id: 'hgb.balance-sheet',
    type: BookkeepingStatementType.BALANCE_SHEET,
    label: $t`Balance sheet`,
    positiveBalance: 'debit',
    resultPosition: 'equity-and-liabilities.A.V',
    positions: [
        {
            id: 'assets',
            label: $t`Assets`,
            positions: [
                {
                    id: 'assets.A',
                    label: $t`Fixed assets`,
                    positions: [
                        {
                            id: 'assets.A.I',
                            label: $t`Intangible assets`,
                            positions: [
                                { id: 'assets.A.I.1', label: $t`Self-created industrial property rights and similar rights and assets` },
                                {
                                    id: 'assets.A.I.2',
                                    // eslint-disable-next-line stylistic/max-len -- one template, since it is the key of its translation
                                    label: $t`Purchased concessions, industrial property rights and similar rights and assets, and licenses in such rights and assets`
                                },
                                { id: 'assets.A.I.3', label: $t`Goodwill` },
                                { id: 'assets.A.I.4', label: $t`Prepayments made` }
                            ]
                        },
                        {
                            id: 'assets.A.II',
                            label: $t`Tangible assets`,
                            positions: [
                                {
                                    id: 'assets.A.II.1',
                                    label: $t`Land, land rights and buildings, including buildings on third-party land`
                                },
                                { id: 'assets.A.II.2', label: $t`Technical equipment and machinery` },
                                { id: 'assets.A.II.3', label: $t`Other equipment, operating and office equipment` },
                                { id: 'assets.A.II.4', label: $t`Prepayments made and assets under construction` }
                            ]
                        },
                        {
                            id: 'assets.A.III',
                            label: $t`Financial assets`,
                            positions: [
                                { id: 'assets.A.III.1', label: $t`Shares in affiliated companies` },
                                { id: 'assets.A.III.2', label: $t`Loans to affiliated companies` },
                                { id: 'assets.A.III.3', label: $t`Participations` },
                                { id: 'assets.A.III.4', label: $t`Loans to companies in which participations are held` },
                                { id: 'assets.A.III.5', label: $t`Long-term securities` },
                                { id: 'assets.A.III.6', label: $t`Other loans` }
                            ]
                        }
                    ]
                },
                {
                    id: 'assets.B',
                    label: $t`Current assets`,
                    positions: [
                        {
                            id: 'assets.B.I',
                            label: $t`Inventories`,
                            positions: [
                                { id: 'assets.B.I.1', label: $t`Raw materials and supplies` },
                                { id: 'assets.B.I.2', label: $t`Work in progress` },
                                { id: 'assets.B.I.3', label: $t`Finished goods and merchandise` },
                                { id: 'assets.B.I.4', label: $t`Prepayments made` }
                            ]
                        },
                        {
                            id: 'assets.B.II',
                            label: $t`Receivables and other assets`,
                            positions: [
                                { id: 'assets.B.II.1', label: $t`Trade receivables` },
                                { id: 'assets.B.II.2', label: $t`Receivables from affiliated companies` },
                                { id: 'assets.B.II.3', label: $t`Receivables from companies in which participations are held` },
                                { id: 'assets.B.II.4', label: $t`Other assets` }
                            ]
                        },
                        {
                            id: 'assets.B.III',
                            label: $t`Securities`,
                            positions: [
                                { id: 'assets.B.III.1', label: $t`Shares in affiliated companies` },
                                { id: 'assets.B.III.2', label: $t`Other securities` }
                            ]
                        },
                        { id: 'assets.B.IV', label: $t`Cash on hand, central bank balances, bank balances and checks` }
                    ]
                },
                { id: 'assets.C', label: $t`Prepaid expenses` },
                { id: 'assets.D', label: $t`Deferred tax assets` },
                { id: 'assets.E', label: $t`Excess of plan assets over pension liabilities` }
            ]
        },
        {
            id: 'equity-and-liabilities',
            label: $t`Equity and liabilities`,
            positiveBalance: 'credit',
            positions: [
                {
                    id: 'equity-and-liabilities.A',
                    label: $t`Equity`,
                    positions: [
                        { id: 'equity-and-liabilities.A.I', label: $t`Subscribed capital` },
                        { id: 'equity-and-liabilities.A.II', label: $t`Capital reserve` },
                        {
                            id: 'equity-and-liabilities.A.III',
                            label: $t`Revenue reserves`,
                            positions: [
                                { id: 'equity-and-liabilities.A.III.1', label: $t`Legal reserve` },
                                {
                                    id: 'equity-and-liabilities.A.III.2',
                                    label: $t`Reserve for shares in a controlling or majority-owning company`
                                },
                                { id: 'equity-and-liabilities.A.III.3', label: $t`Statutory reserves` },
                                { id: 'equity-and-liabilities.A.III.4', label: $t`Other revenue reserves` }
                            ]
                        },
                        { id: 'equity-and-liabilities.A.IV', label: $t`Profit or loss carried forward` },
                        { id: 'equity-and-liabilities.A.V', label: $t`Net income or net loss for the year` }
                    ]
                },
                {
                    id: 'equity-and-liabilities.B',
                    label: $t`Provisions`,
                    positions: [
                        { id: 'equity-and-liabilities.B.1', label: $t`Provisions for pensions and similar obligations` },
                        { id: 'equity-and-liabilities.B.2', label: $t`Tax provisions` },
                        { id: 'equity-and-liabilities.B.3', label: $t`Other provisions` }
                    ]
                },
                {
                    id: 'equity-and-liabilities.C',
                    label: $t`Liabilities`,
                    positions: [
                        { id: 'equity-and-liabilities.C.1', label: $t`Bonds` },
                        { id: 'equity-and-liabilities.C.2', label: $t`Liabilities to banks` },
                        { id: 'equity-and-liabilities.C.3', label: $t`Payments received on account of orders` },
                        { id: 'equity-and-liabilities.C.4', label: $t`Trade payables` },
                        { id: 'equity-and-liabilities.C.5', label: $t`Liabilities on bills of exchange accepted and drawn` },
                        { id: 'equity-and-liabilities.C.6', label: $t`Liabilities to affiliated companies` },
                        { id: 'equity-and-liabilities.C.7', label: $t`Liabilities to companies in which participations are held` },
                        { id: 'equity-and-liabilities.C.8', label: $t`Other liabilities` }
                    ]
                },
                { id: 'equity-and-liabilities.D', label: $t`Deferred income` },
                { id: 'equity-and-liabilities.E', label: $t`Deferred tax liabilities` }
            ]
        }
    ],
    name: $t`Balance sheet (§ 266 HGB)`
};