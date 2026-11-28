/* eslint-disable cspell/spellchecker, stylistic/max-len, sonar/no-duplicate-string */
// a chart reads as a table: one account per line, its position spelled out, its name German
import { BookkeepingAccountType } from '../../models/bookkeeping-account-type.enum';
import { type ChartOfAccountsRow } from '../chart-of-accounts-row.type';

const EQUITY: BookkeepingAccountType = BookkeepingAccountType.EQUITY;

/**
 * The accounts of class 2 of the SKR 04: the equity of a corporation.
 */
export const SKR04_CLASS_2_ACCOUNTS: ChartOfAccountsRow[] = [
    // subscribed capital
    ['2900', 'Gezeichnetes Kapital', EQUITY, 'equity-and-liabilities.A.I'],
    ['2908', 'Erhöhung des Kapitals aus Gesellschaftsmitteln', EQUITY, 'equity-and-liabilities.A.I'],
    ['2910', 'Nicht eingeforderte ausstehende Einlagen, vom gezeichneten Kapital abgesetzt', EQUITY, 'equity-and-liabilities.A.I'],

    // capital reserve
    ['2920', 'Kapitalrücklage', EQUITY, 'equity-and-liabilities.A.II'],
    ['2925', 'Kapitalrücklage aus einem Aufgeld bei der Ausgabe von Anteilen', EQUITY, 'equity-and-liabilities.A.II'],
    ['2926', 'Kapitalrücklage aus Wandlungs- und Optionsrechten', EQUITY, 'equity-and-liabilities.A.II'],
    ['2927', 'Kapitalrücklage aus Zuzahlungen für einen Vorzug', EQUITY, 'equity-and-liabilities.A.II'],
    ['2928', 'Kapitalrücklage aus anderen Zuzahlungen in das Eigenkapital', EQUITY, 'equity-and-liabilities.A.II'],
    ['2929', 'Eingefordertes Nachschusskapital', EQUITY, 'equity-and-liabilities.A.II'],

    // revenue reserves
    ['2930', 'Gesetzliche Rücklage', EQUITY, 'equity-and-liabilities.A.III.1'],
    ['2935', 'Rücklage für Anteile an einem herrschenden oder mehrheitlich beteiligten Unternehmen', EQUITY, 'equity-and-liabilities.A.III.2'],
    ['2937', 'Sonstige Ergebnisrücklagen', EQUITY, 'equity-and-liabilities.A.III.4'],
    ['2950', 'Satzungsmäßige Rücklagen', EQUITY, 'equity-and-liabilities.A.III.3'],
    ['2960', 'Andere Gewinnrücklagen', EQUITY, 'equity-and-liabilities.A.III.4'],
    ['2961', 'Gewinnrücklagen aus dem Erwerb eigener Anteile', EQUITY, 'equity-and-liabilities.A.III.4'],
    ['2962', 'Eigenkapitalanteil aus Wertaufholungen', EQUITY, 'equity-and-liabilities.A.III.4'],

    // profit or loss carried forward
    ['2970', 'Vorgetragener Gewinn vor Verwendung', EQUITY, 'equity-and-liabilities.A.IV'],
    ['2975', 'Vorgetragener Gewinn vor Verwendung, aufgeteilt für die Kapitalkontenentwicklung', EQUITY, 'equity-and-liabilities.A.IV'],
    ['2977', 'Vorgetragener Verlust vor Verwendung, aufgeteilt für die Kapitalkontenentwicklung', EQUITY, 'equity-and-liabilities.A.IV'],
    ['2978', 'Vorgetragener Verlust vor Verwendung', EQUITY, 'equity-and-liabilities.A.IV']
];