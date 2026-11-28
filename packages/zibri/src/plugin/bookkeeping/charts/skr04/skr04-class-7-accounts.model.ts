/* eslint-disable cspell/spellchecker, stylistic/max-len, sonar/no-duplicate-string */
// a chart reads as a table: one account per line, its position spelled out, its name German
import { BookkeepingAccountType } from '../../models/bookkeeping-account-type.enum';
import { type ChartOfAccountsRow } from '../chart-of-accounts-row.type';

const EQUITY: BookkeepingAccountType = BookkeepingAccountType.EQUITY;
const EXPENSE: BookkeepingAccountType = BookkeepingAccountType.EXPENSE;
const REVENUE: BookkeepingAccountType = BookkeepingAccountType.REVENUE;

/**
 * The accounts of class 7 of the SKR 04: the financial income and expenses, the taxes, and the appropriation of the
 * result.
 */
export const SKR04_CLASS_7_ACCOUNTS: ChartOfAccountsRow[] = [
    // income from participations
    ['7000', 'Erträge aus Beteiligungen', REVENUE, 'income-statement.9'],
    ['7002', 'Erträge aus Beteiligungen als typisch stiller Gesellschafter', REVENUE, 'income-statement.9'],
    ['7003', 'Erträge aus Beteiligungen als atypisch stiller Gesellschafter', REVENUE, 'income-statement.9'],
    ['7004', 'Erträge aus Beteiligungen an verbundenen Personengesellschaften, § 9 GewStG oder § 18 EStG', REVENUE, 'income-statement.9'],
    ['7005', 'Erträge aus Beteiligungen an Kapitalgesellschaften nach § 3 Nr. 40 EStG oder § 8b Abs. 1 KStG', REVENUE, 'income-statement.9'],
    ['7006', 'Erträge aus Anteilen an verbundenen Kapitalgesellschaften nach § 3 Nr. 40 EStG oder § 8b Abs. 1 KStG', REVENUE, 'income-statement.9'],
    ['7008', 'Gewinnanteile aus gewerblichen und selbständigen Mitunternehmerschaften, § 9 GewStG oder § 18 EStG', REVENUE, 'income-statement.9'],
    ['7009', 'Erträge aus Beteiligungen, von verbundenen Unternehmen', REVENUE, 'income-statement.9'],

    // income from other securities and loans of the financial assets
    ['7010', 'Erträge aus anderen Wertpapieren und Ausleihungen des Finanzanlagevermögens', REVENUE, 'income-statement.10'],
    ['7011', 'Erträge aus langfristigen Ausleihungen', REVENUE, 'income-statement.10'],
    ['7012', 'Erträge aus langfristigen Ausleihungen an verbundene Unternehmen', REVENUE, 'income-statement.10'],
    ['7013', 'Erträge aus Anteilen an Personengesellschaften im Finanzanlagevermögen', REVENUE, 'income-statement.10'],
    ['7014', 'Erträge aus Anteilen an Kapitalgesellschaften im Finanzanlagevermögen nach § 3 Nr. 40 EStG oder § 8b Abs. 1 und 4 KStG', REVENUE, 'income-statement.10'],
    ['7015', 'Erträge aus Anteilen an verbundenen Kapitalgesellschaften im Finanzanlagevermögen nach § 3 Nr. 40 EStG oder § 8b Abs. 1 KStG', REVENUE, 'income-statement.10'],
    ['7016', 'Erträge aus Anteilen an verbundenen Personengesellschaften im Finanzanlagevermögen', REVENUE, 'income-statement.10'],
    ['7017', 'Erträge aus anderen Wertpapieren des Finanzanlagevermögens, verbundene Kapitalgesellschaften', REVENUE, 'income-statement.10'],
    ['7018', 'Erträge aus anderen Wertpapieren des Finanzanlagevermögens, verbundene Personengesellschaften', REVENUE, 'income-statement.10'],
    ['7019', 'Erträge aus anderen Wertpapieren und Ausleihungen des Finanzanlagevermögens von verbundenen Unternehmen', REVENUE, 'income-statement.10'],
    ['7020', 'Erträge aus Zinsen und Dividenden', REVENUE, 'income-statement.10'],
    ['7030', 'Ausgleichszahlungen, erhalten als außenstehender Aktionär', REVENUE, 'income-statement.10'],

    // interest income
    ['7100', 'Sonstige Zinsen und ähnliche Erträge', REVENUE, 'income-statement.11'],
    ['7103', 'Erträge aus Anteilen an Kapitalgesellschaften im Umlaufvermögen nach § 3 Nr. 40 EStG oder § 8b Abs. 1 und 4 KStG', REVENUE, 'income-statement.11'],
    ['7104', 'Erträge aus Anteilen an verbundenen Kapitalgesellschaften im Umlaufvermögen nach § 3 Nr. 40 EStG oder § 8b Abs. 1 KStG', REVENUE, 'income-statement.11'],
    ['7105', 'Zinserträge nach § 233a AO, steuerpflichtig', REVENUE, 'income-statement.11'],
    ['7106', 'Zinserträge nach § 233a AO, steuerfrei', REVENUE, 'income-statement.11'],
    ['7107', 'Zinserträge nach § 233a AO und § 4 Abs. 5b EStG, steuerfrei', REVENUE, 'income-statement.11'],
    ['7109', 'Sonstige Zinsen und ähnliche Erträge von verbundenen Unternehmen', REVENUE, 'income-statement.11'],
    ['7110', 'Andere Zinserträge', REVENUE, 'income-statement.11'],
    ['7115', 'Erträge aus anderen Wertpapieren und Ausleihungen, Umlaufvermögen', REVENUE, 'income-statement.11'],
    ['7119', 'Andere Zinserträge von verbundenen Unternehmen', REVENUE, 'income-statement.11'],
    ['7120', 'Erträge ähnlich Zinsen', REVENUE, 'income-statement.11'],
    ['7129', 'Erträge ähnlich Zinsen von verbundenen Unternehmen', REVENUE, 'income-statement.11'],
    ['7140', 'Zinserträge aus der Abzinsung von Rückstellungen, steuerfrei', REVENUE, 'income-statement.11'],
    ['7141', 'Zinserträge aus der Abzinsung von Rentenverbindlichkeiten ohne künftige Gegenleistung', REVENUE, 'income-statement.11'],
    ['7142', 'Erträge aus der Abzinsung von Rückstellungen', REVENUE, 'income-statement.11'],
    ['7143', 'Zinserträge aus der Abzinsung von Pensionsrückstellungen und ähnlichen Verpflichtungen', REVENUE, 'income-statement.11'],
    ['7144', 'Zinserträge aus der Abzinsung von Pensionsverpflichtungen, verrechnet nach § 246 Abs. 2 HGB', REVENUE, 'income-statement.13', 'income-statement.11'],
    ['7145', 'Erträge aus Deckungsvermögen, verrechnet nach § 246 Abs. 2 HGB', REVENUE, 'income-statement.13', 'income-statement.11'],

    // write-downs of financial assets and of securities held as current assets
    ['7200', 'Dauerhafte Abschreibungen auf Finanzanlagen', EXPENSE, 'income-statement.12'],
    ['7201', 'Vorübergehende Abschreibungen auf Finanzanlagen', EXPENSE, 'income-statement.12'],
    ['7204', 'Abschreibungen auf Finanzanlagen nach § 3 Nr. 40 EStG oder § 8b Abs. 3 KStG, dauerhaft', EXPENSE, 'income-statement.12'],
    ['7207', 'Abschreibungen auf Finanzanlagen bei verbundenen Unternehmen', EXPENSE, 'income-statement.12'],
    ['7208', 'Verlustanteile an gewerblichen und selbständigen Mitunternehmerschaften, § 8 GewStG oder § 18 EStG', EXPENSE, 'income-statement.12'],
    ['7210', 'Abschreibungen auf Wertpapiere des Umlaufvermögens', EXPENSE, 'income-statement.12'],
    ['7214', 'Abschreibungen auf Wertpapiere des Umlaufvermögens nach § 3 Nr. 40 EStG oder § 8b Abs. 3 KStG', EXPENSE, 'income-statement.12'],
    ['7217', 'Abschreibungen auf Wertpapiere des Umlaufvermögens bei verbundenen Unternehmen', EXPENSE, 'income-statement.12'],
    ['7250', 'Abschreibungen auf Finanzanlagen wegen einer Rücklage nach § 6b EStG', EXPENSE, 'income-statement.12'],
    ['7255', 'Abschreibungen auf Finanzanlagen wegen einer Rücklage nach § 6b EStG, nach § 3 Nr. 40 EStG oder § 8b Abs. 3 KStG', EXPENSE, 'income-statement.12'],

    // interest expenses
    ['7300', 'Zinsen und ähnliche Aufwendungen', EXPENSE, 'income-statement.13'],
    ['7302', 'Andere Nebenleistungen zu Steuern nach § 4 Abs. 5b EStG, steuerlich nicht abziehbar', EXPENSE, 'income-statement.13'],
    ['7303', 'Andere Nebenleistungen zu Steuern, steuerlich abziehbar', EXPENSE, 'income-statement.13'],
    ['7304', 'Andere Nebenleistungen zu Steuern, steuerlich nicht abziehbar', EXPENSE, 'income-statement.13'],
    ['7305', 'Zinsaufwendungen nach § 233a AO, abziehbar', EXPENSE, 'income-statement.13'],
    ['7306', 'Zinsaufwendungen nach §§ 234 bis 237 AO, nicht abziehbar', EXPENSE, 'income-statement.13'],
    ['7308', 'Zinsaufwendungen nach § 233a AO, nicht abziehbar', EXPENSE, 'income-statement.13'],
    ['7309', 'Zinsen an verbundene Unternehmen', EXPENSE, 'income-statement.13'],
    ['7310', 'Zinsen für kurzfristige Verbindlichkeiten', EXPENSE, 'income-statement.13'],
    ['7311', 'Zinsaufwendungen nach §§ 234 bis 237 AO, abziehbar', EXPENSE, 'income-statement.13'],
    ['7313', 'Schuldzinsen nach § 4 Abs. 4a EStG, nicht abziehbar', EXPENSE, 'income-statement.13'],
    ['7316', 'Zinsen auf Darlehen von Gesellschaftern', EXPENSE, 'income-statement.13'],
    ['7317', 'Zinsen an Gesellschafter mit mehr als 25 % Beteiligung und ihnen nahestehende Personen', EXPENSE, 'income-statement.13'],
    ['7318', 'Zinsen für Kontokorrentkredite', EXPENSE, 'income-statement.13'],
    ['7319', 'Zinsen für kurzfristige Verbindlichkeiten an verbundene Unternehmen', EXPENSE, 'income-statement.13'],
    ['7320', 'Zinsen für langfristige Verbindlichkeiten', EXPENSE, 'income-statement.13'],
    ['7323', 'Abschreibungen auf ein Agio oder Disagio der Finanzierung', EXPENSE, 'income-statement.13'],
    ['7324', 'Abschreibungen auf ein Agio oder Disagio der Finanzierung des Anlagevermögens', EXPENSE, 'income-statement.13'],
    ['7325', 'Zinsaufwendungen für Gebäude des Betriebsvermögens', EXPENSE, 'income-statement.13'],
    ['7326', 'Zinsen für die Finanzierung des Anlagevermögens', EXPENSE, 'income-statement.13'],
    ['7327', 'Dauernde Lasten und Renten', EXPENSE, 'income-statement.13'],
    ['7328', 'Zinsen für Kapital von Mitunternehmern nach § 15 EStG, Gegenstück zu Sonderbetriebseinnahmen', EXPENSE, 'income-statement.13'],
    ['7329', 'Zinsen für langfristige Verbindlichkeiten an verbundene Unternehmen', EXPENSE, 'income-statement.13'],
    ['7330', 'Aufwendungen ähnlich Zinsen', EXPENSE, 'income-statement.13'],
    ['7339', 'Aufwendungen ähnlich Zinsen an verbundene Unternehmen', EXPENSE, 'income-statement.13'],
    ['7350', 'Zinsen und ähnliche Aufwendungen nach §§ 3 Nr. 40 und 3c EStG oder § 8b Abs. 1 und 4 KStG', EXPENSE, 'income-statement.13'],
    ['7351', 'Zinsen und ähnliche Aufwendungen an verbundene Unternehmen nach §§ 3 Nr. 40 und 3c EStG oder § 8b Abs. 1 KStG', EXPENSE, 'income-statement.13'],
    ['7355', 'Provisionen und Verwaltungskosten für Kredite', EXPENSE, 'income-statement.13'],
    ['7360', 'Zinsanteil der Zuführung zu Pensionsrückstellungen', EXPENSE, 'income-statement.13'],
    ['7361', 'Zinsaufwendungen aus der Abzinsung von Rentenverbindlichkeiten ohne künftige Gegenleistung', EXPENSE, 'income-statement.13'],
    ['7362', 'Aufwand aus der Abzinsung von Rückstellungen', EXPENSE, 'income-statement.13'],
    ['7363', 'Zinsaufwendungen aus der Abzinsung von Pensionsrückstellungen und ähnlichen Verpflichtungen', EXPENSE, 'income-statement.13'],
    ['7364', 'Zinsaufwendungen aus der Abzinsung von Pensionsverpflichtungen, verrechnet nach § 246 Abs. 2 HGB', EXPENSE, 'income-statement.13', 'income-statement.11'],
    ['7365', 'Aufwendungen aus Deckungsvermögen, verrechnet nach § 246 Abs. 2 HGB', EXPENSE, 'income-statement.13', 'income-statement.11'],
    ['7366', 'Zinsaufwendungen aus der Abzinsung von Rückstellungen, steuerlich nicht abziehbar', EXPENSE, 'income-statement.13'],

    // mergers, conversions and restructuring
    ['7451', 'Erträge aus Verschmelzung und Umwandlung', REVENUE, 'income-statement.4'],
    ['7551', 'Verluste aus Verschmelzung und Umwandlung', EXPENSE, 'income-statement.8'],
    ['7553', 'Aufwendungen für Restrukturierung und Sanierung', EXPENSE, 'income-statement.8'],

    // taxes on income
    ['7600', 'Körperschaftsteuer', EXPENSE, 'income-statement.14'],
    ['7603', 'Körperschaftsteuer früherer Jahre', EXPENSE, 'income-statement.14', 'income-statement.14'],
    ['7604', 'Erstattungen von Körperschaftsteuer früherer Jahre', EXPENSE, 'income-statement.14'],
    ['7607', 'Erstattungen des Solidaritätszuschlags früherer Jahre', EXPENSE, 'income-statement.14'],
    ['7608', 'Solidaritätszuschlag', EXPENSE, 'income-statement.14'],
    ['7609', 'Solidaritätszuschlag früherer Jahre', EXPENSE, 'income-statement.14', 'income-statement.14'],
    ['7610', 'Gewerbesteuer', EXPENSE, 'income-statement.14'],
    ['7630', 'Kapitalertragsteuer 25 %', EXPENSE, 'income-statement.14'],
    ['7633', 'Anrechenbarer Solidaritätszuschlag auf die Kapitalertragsteuer 25 %', EXPENSE, 'income-statement.14'],
    ['7638', 'Ausländische Steuer auf Einkünfte, die nach einem Doppelbesteuerungsabkommen im Inland steuerfrei sind', EXPENSE, 'income-statement.14'],
    ['7639', 'Anrechnung oder Abzug ausländischer Quellensteuer', EXPENSE, 'income-statement.14'],
    ['7641', 'Nachzahlungen und Erstattungen von Gewerbesteuer früherer Jahre nach § 4 Abs. 5b EStG', EXPENSE, 'income-statement.14', 'income-statement.14'],
    ['7643', 'Erträge aus aufgelösten Rückstellungen für Gewerbesteuer nach § 4 Abs. 5b EStG', EXPENSE, 'income-statement.14'],
    ['7645', 'Aufwendungen aus der Bildung und Auflösung latenter Steuern', EXPENSE, 'income-statement.14'],
    ['7646', 'Zuführung zu Steuerrückstellungen für gestundete Steuern', EXPENSE, 'income-statement.14'],
    ['7648', 'Erträge aus aufgelösten Steuerrückstellungen für gestundete Steuern', EXPENSE, 'income-statement.14'],
    ['7649', 'Erträge aus der Bildung und Auflösung latenter Steuern', EXPENSE, 'income-statement.14'],

    // other taxes
    ['7650', 'Sonstige Steuern des Betriebs', EXPENSE, 'income-statement.16'],
    ['7675', 'Verbrauchsteuern', EXPENSE, 'income-statement.16'],
    ['7678', 'Energie- und Stromsteuer', EXPENSE, 'income-statement.16'],
    ['7680', 'Grundsteuer', EXPENSE, 'income-statement.16'],
    ['7685', 'Kraftfahrzeugsteuer', EXPENSE, 'income-statement.16'],
    ['7690', 'Nachzahlungen sonstiger Steuern früherer Jahre', EXPENSE, 'income-statement.16'],
    ['7692', 'Erstattungen sonstiger Steuern früherer Jahre', EXPENSE, 'income-statement.16'],
    ['7694', 'Erträge aus aufgelösten Rückstellungen für sonstige Steuern', EXPENSE, 'income-statement.16'],

    // appropriation of the result: equity, reported with the result of the year
    ['7700', 'Vorgetragener Gewinn nach Verwendung', EQUITY, 'equity-and-liabilities.A.IV'],
    ['7705', 'Vorgetragener Gewinn nach Verwendung, aufgeteilt für die Kapitalkontenentwicklung', EQUITY, 'equity-and-liabilities.A.IV'],
    ['7720', 'Vorgetragener Verlust nach Verwendung', EQUITY, 'equity-and-liabilities.A.IV'],
    ['7725', 'Vorgetragener Verlust nach Verwendung, aufgeteilt für die Kapitalkontenentwicklung', EQUITY, 'equity-and-liabilities.A.IV'],
    ['7730', 'Auflösung der Kapitalrücklage', EQUITY, 'equity-and-liabilities.A.V'],
    ['7735', 'Auflösung der gesetzlichen Rücklage', EQUITY, 'equity-and-liabilities.A.V'],
    ['7740', 'Auflösung des Ausgleichspostens für aktivierte eigene Anteile', EQUITY, 'equity-and-liabilities.A.V'],
    ['7743', 'Auflösung der Rücklage für Anteile an einem herrschenden oder mehrheitlich beteiligten Unternehmen', EQUITY, 'equity-and-liabilities.A.V'],
    ['7744', 'Auflösung sonstiger Ergebnisrücklagen', EQUITY, 'equity-and-liabilities.A.V'],
    ['7745', 'Auflösung satzungsmäßiger Rücklagen', EQUITY, 'equity-and-liabilities.A.V'],
    ['7750', 'Auflösung anderer Gewinnrücklagen', EQUITY, 'equity-and-liabilities.A.V'],
    ['7751', 'Auflösung gesamthänderisch gebundener Rücklagen, aufgeteilt für die Kapitalkontenentwicklung', EQUITY, 'equity-and-liabilities.A.V'],
    ['7755', 'Ertrag aus der Herabsetzung des Kapitals', EQUITY, 'equity-and-liabilities.A.V'],
    ['7760', 'Zuführung zur Kapitalrücklage bei einer vereinfachten Kapitalherabsetzung', EQUITY, 'equity-and-liabilities.A.V'],
    ['7765', 'Zuführung zur gesetzlichen Rücklage', EQUITY, 'equity-and-liabilities.A.V'],
    ['7770', 'Zuführung zum Ausgleichsposten für aktivierte eigene Anteile', EQUITY, 'equity-and-liabilities.A.V'],
    ['7773', 'Zuführung zur Rücklage für Anteile an einem herrschenden oder mehrheitlich beteiligten Unternehmen', EQUITY, 'equity-and-liabilities.A.V'],
    ['7775', 'Zuführung zu satzungsmäßigen Rücklagen', EQUITY, 'equity-and-liabilities.A.V'],
    ['7780', 'Zuführung zu anderen Gewinnrücklagen', EQUITY, 'equity-and-liabilities.A.V'],
    ['7781', 'Zuführung zu gesamthänderisch gebundenen Rücklagen, aufgeteilt für die Kapitalkontenentwicklung', EQUITY, 'equity-and-liabilities.A.V'],
    ['7785', 'Zuführung zu sonstigen Ergebnisrücklagen', EQUITY, 'equity-and-liabilities.A.V'],
    ['7790', 'Ausschüttung im Voraus', EQUITY, 'equity-and-liabilities.A.V']
];