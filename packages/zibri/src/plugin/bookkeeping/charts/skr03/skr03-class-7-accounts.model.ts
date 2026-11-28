/* eslint-disable sonar/no-duplicate-string */
// a chart reads as a table: one account per line, its position spelled out
import { BookkeepingAccountType } from '../../models/bookkeeping-account-type.enum';
import { type ChartOfAccountsRow } from '../chart-of-accounts-row.type';

const ASSET: BookkeepingAccountType = BookkeepingAccountType.ASSET;

/**
 * The accounts of class 7 of the SKR 03: the stock of products and of work in progress.
 */
export const SKR03_CLASS_7_ACCOUNTS: ChartOfAccountsRow[] = [
    ['7000', 'Bestand an unfertigen Erzeugnissen und Leistungen', ASSET, 'assets.B.I.2'],
    ['7050', 'Bestand an unfertigen Erzeugnissen', ASSET, 'assets.B.I.2'],
    ['7080', 'Bestand an unfertigen Leistungen', ASSET, 'assets.B.I.2'],
    ['7090', 'Bauaufträge in Ausführung', ASSET, 'assets.B.I.2'],
    ['7095', 'Aufträge in Arbeit', ASSET, 'assets.B.I.2'],
    ['7100', 'Bestand an fertigen Erzeugnissen und Waren', ASSET, 'assets.B.I.3'],
    ['7110', 'Bestand an fertigen Erzeugnissen', ASSET, 'assets.B.I.3'],
    ['7140', 'Bestand an Waren', ASSET, 'assets.B.I.3']
];
