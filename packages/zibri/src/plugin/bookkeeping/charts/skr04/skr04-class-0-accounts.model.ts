/* eslint-disable cspell/spellchecker, sonar/no-duplicate-string */
// a chart reads as a table: one account per line, its position spelled out, its name German
import { BookkeepingAccountType } from '../../models/bookkeeping-account-type.enum';
import { type ChartOfAccountsRow } from '../chart-of-accounts-row.type';

const ASSET: BookkeepingAccountType = BookkeepingAccountType.ASSET;
const EQUITY: BookkeepingAccountType = BookkeepingAccountType.EQUITY;

/**
 * The accounts of class 0 of the SKR 04: the contributions not called in yet and the fixed assets.
 */
export const SKR04_CLASS_0_ACCOUNTS: ChartOfAccountsRow[] = [
    // contributions outstanding
    ['0050', 'Nicht eingeforderte ausstehende Einlagen der Vollhafter', EQUITY, 'equity-and-liabilities.A.I'],
    ['0070', 'Nicht eingeforderte ausstehende Einlagen der Teilhafter', EQUITY, 'equity-and-liabilities.A.I'],
    ['0090', 'Fällige, noch nicht gezahlte Einzahlungen auf Geschäftsanteile', ASSET, 'assets.B.II.4'],

    // intangible assets
    ['0100', 'Erworbene Konzessionen, Schutzrechte und Lizenzen', ASSET, 'assets.A.I.2'],
    ['0110', 'Konzessionen', ASSET, 'assets.A.I.2'],
    ['0120', 'Gewerbliche Schutzrechte', ASSET, 'assets.A.I.2'],
    ['0130', 'Ähnliche Rechte und Werte', ASSET, 'assets.A.I.2'],
    ['0135', 'Software, erworben', ASSET, 'assets.A.I.2'],
    ['0140', 'Lizenzen an Schutzrechten und ähnlichen Rechten', ASSET, 'assets.A.I.2'],
    ['0143', 'Immaterielle Vermögensgegenstände, selbst geschaffen', ASSET, 'assets.A.I.1'],
    ['0144', 'Software, selbst geschaffen', ASSET, 'assets.A.I.1'],
    ['0145', 'Lizenzen und Franchiseverträge, selbst geschaffen', ASSET, 'assets.A.I.1'],
    ['0146', 'Konzessionen und Schutzrechte, selbst geschaffen', ASSET, 'assets.A.I.1'],
    ['0147', 'Rezepturen, Verfahren und Prototypen, selbst geschaffen', ASSET, 'assets.A.I.1'],
    ['0148', 'Selbst geschaffene immaterielle Werte in der Entwicklung', ASSET, 'assets.A.I.1'],
    ['0150', 'Geschäfts- oder Firmenwert', ASSET, 'assets.A.I.3'],
    ['0170', 'Anzahlungen auf immaterielle Vermögensgegenstände', ASSET, 'assets.A.I.4'],
    ['0179', 'Anzahlungen auf einen Geschäfts- oder Firmenwert', ASSET, 'assets.A.I.4'],

    // land and buildings
    ['0200', 'Grundstücke und Bauten, auch auf fremdem Grund', ASSET, 'assets.A.II.1'],
    ['0210', 'Grundstücksgleiche Rechte, unbebaut', ASSET, 'assets.A.II.1'],
    ['0215', 'Grundstücke ohne Bebauung', ASSET, 'assets.A.II.1'],
    ['0220', 'Erbbau- und Dauerwohnrechte, unbebaut', ASSET, 'assets.A.II.1'],
    ['0225', 'Grundstücke, deren Substanz verbraucht wird', ASSET, 'assets.A.II.1'],
    ['0229', 'Anteil des häuslichen Arbeitszimmers am Grundstück', ASSET, 'assets.A.II.1'],
    ['0230', 'Bauten auf eigenem Grund und grundstücksgleichen Rechten', ASSET, 'assets.A.II.1'],
    ['0235', 'Grund und Boden bebauter eigener Grundstücke', ASSET, 'assets.A.II.1'],
    ['0240', 'Geschäftsgebäude', ASSET, 'assets.A.II.1'],
    ['0250', 'Fabrikgebäude', ASSET, 'assets.A.II.1'],
    ['0260', 'Sonstige Bauten auf eigenem Grund', ASSET, 'assets.A.II.1'],
    ['0270', 'Garagen auf eigenem Grund', ASSET, 'assets.A.II.1'],
    ['0280', 'Außenanlagen zu Geschäfts-, Fabrik- und sonstigen Bauten', ASSET, 'assets.A.II.1'],
    ['0285', 'Befestigte Höfe und Wege', ASSET, 'assets.A.II.1'],
    ['0290', 'Einbauten in Geschäfts-, Fabrik- und sonstige Bauten', ASSET, 'assets.A.II.1'],
    ['0300', 'Wohngebäude', ASSET, 'assets.A.II.1'],
    ['0305', 'Garagen zu Wohngebäuden', ASSET, 'assets.A.II.1'],
    ['0310', 'Außenanlagen zu Wohngebäuden', ASSET, 'assets.A.II.1'],
    ['0315', 'Befestigte Höfe und Wege zu Wohngebäuden', ASSET, 'assets.A.II.1'],
    ['0320', 'Einbauten in Wohngebäude', ASSET, 'assets.A.II.1'],
    ['0329', 'Anteil des häuslichen Arbeitszimmers am Gebäude', ASSET, 'assets.A.II.1'],
    ['0330', 'Bauten auf fremdem Grund', ASSET, 'assets.A.II.1'],
    ['0340', 'Geschäftsgebäude auf fremdem Grund', ASSET, 'assets.A.II.1'],
    ['0350', 'Fabrikgebäude auf fremdem Grund', ASSET, 'assets.A.II.1'],
    ['0360', 'Wohngebäude auf fremdem Grund', ASSET, 'assets.A.II.1'],
    ['0370', 'Sonstige Bauten auf fremdem Grund', ASSET, 'assets.A.II.1'],
    ['0380', 'Garagen auf fremdem Grund', ASSET, 'assets.A.II.1'],
    ['0390', 'Außenanlagen auf fremdem Grund', ASSET, 'assets.A.II.1'],
    ['0395', 'Befestigte Höfe und Wege auf fremdem Grund', ASSET, 'assets.A.II.1'],
    ['0398', 'Einbauten in Bauten auf fremdem Grund', ASSET, 'assets.A.II.1'],

    // technical equipment and machines
    ['0400', 'Technische Anlagen und Maschinen', ASSET, 'assets.A.II.2'],
    ['0420', 'Technische Anlagen', ASSET, 'assets.A.II.2'],
    ['0440', 'Maschinen', ASSET, 'assets.A.II.2'],
    ['0450', 'Transport- und Förderanlagen', ASSET, 'assets.A.II.2'],
    ['0460', 'Werkzeuge, die an Maschinen gebunden sind', ASSET, 'assets.A.II.2'],
    ['0470', 'Betriebsvorrichtungen', ASSET, 'assets.A.II.2'],

    // other equipment, operating and office equipment
    ['0500', 'Andere Anlagen, Betriebs- und Geschäftsausstattung', ASSET, 'assets.A.II.3'],
    ['0510', 'Andere Anlagen', ASSET, 'assets.A.II.3'],
    ['0520', 'Personenkraftwagen', ASSET, 'assets.A.II.3'],
    ['0540', 'Lastkraftwagen', ASSET, 'assets.A.II.3'],
    ['0560', 'Andere Fahrzeuge und Transportmittel', ASSET, 'assets.A.II.3'],
    ['0620', 'Werkzeuge', ASSET, 'assets.A.II.3'],
    ['0630', 'Betriebsausstattung', ASSET, 'assets.A.II.3'],
    ['0635', 'Geschäftsausstattung', ASSET, 'assets.A.II.3'],
    ['0640', 'Ladeneinrichtung', ASSET, 'assets.A.II.3'],
    ['0650', 'Büroeinrichtung', ASSET, 'assets.A.II.3'],
    ['0660', 'Gerüste und Schalungen', ASSET, 'assets.A.II.3'],
    ['0670', 'Geringwertige Wirtschaftsgüter', ASSET, 'assets.A.II.3'],
    ['0675', 'Sammelposten für Wirtschaftsgüter', ASSET, 'assets.A.II.3'],
    ['0680', 'Einbauten auf fremdem Grund', ASSET, 'assets.A.II.3'],
    ['0690', 'Übrige Betriebs- und Geschäftsausstattung', ASSET, 'assets.A.II.3'],

    // payments on account and assets under construction
    ['0700', 'Geleistete Anzahlungen und Anlagen im Bau', ASSET, 'assets.A.II.4'],
    ['0705', 'Anzahlungen auf Grundstücke', ASSET, 'assets.A.II.4'],
    ['0710', 'Geschäfts-, Fabrik- und sonstige Bauten im Bau, eigener Grund', ASSET, 'assets.A.II.4'],
    ['0720', 'Anzahlungen auf Geschäfts-, Fabrik- und sonstige Bauten, eigener Grund', ASSET, 'assets.A.II.4'],
    ['0725', 'Wohngebäude im Bau, eigener Grund', ASSET, 'assets.A.II.4'],
    ['0735', 'Anzahlungen auf Wohngebäude, eigener Grund', ASSET, 'assets.A.II.4'],
    ['0740', 'Geschäfts-, Fabrik- und sonstige Bauten im Bau, fremder Grund', ASSET, 'assets.A.II.4'],
    ['0750', 'Anzahlungen auf Geschäfts-, Fabrik- und sonstige Bauten, fremder Grund', ASSET, 'assets.A.II.4'],
    ['0755', 'Wohngebäude im Bau, fremder Grund', ASSET, 'assets.A.II.4'],
    ['0765', 'Anzahlungen auf Wohngebäude, fremder Grund', ASSET, 'assets.A.II.4'],
    ['0770', 'Technische Anlagen und Maschinen, noch im Bau', ASSET, 'assets.A.II.4'],
    ['0780', 'Geleistete Anzahlungen auf technische Anlagen und Maschinen', ASSET, 'assets.A.II.4'],
    ['0785', 'Andere Anlagen, Betriebs- und Geschäftsausstattung, noch im Bau', ASSET, 'assets.A.II.4'],
    ['0795', 'Geleistete Anzahlungen auf andere Anlagen, Betriebs- und Geschäftsausstattung', ASSET, 'assets.A.II.4'],

    // financial assets
    ['0800', 'Anteile an verbundenen Unternehmen, langfristig gehalten', ASSET, 'assets.A.III.1'],
    ['0803', 'Anteile an verbundenen Personengesellschaften', ASSET, 'assets.A.III.1'],
    ['0804', 'Anteile an verbundenen Kapitalgesellschaften', ASSET, 'assets.A.III.1'],
    ['0805', 'Anteile an der herrschenden oder mehrheitlich beteiligten Personengesellschaft', ASSET, 'assets.A.III.1'],
    ['0806', 'Anteile der GmbH & Co. KG an ihrer Komplementär-GmbH', ASSET, 'assets.A.III.1'],
    ['0808', 'Anteile an der herrschenden oder mehrheitlich beteiligten Kapitalgesellschaft', ASSET, 'assets.A.III.1'],
    ['0809', 'Anteile an der herrschenden oder mehrheitlich beteiligten Gesellschaft', ASSET, 'assets.A.III.1'],
    ['0810', 'Ausleihungen an verbundene Unternehmen', ASSET, 'assets.A.III.2'],
    ['0813', 'Ausleihungen an verbundene Personengesellschaften', ASSET, 'assets.A.III.2'],
    ['0814', 'Ausleihungen an verbundene Kapitalgesellschaften', ASSET, 'assets.A.III.2'],
    ['0815', 'Ausleihungen an verbundene Einzelunternehmen', ASSET, 'assets.A.III.2'],
    ['0820', 'Beteiligungen', ASSET, 'assets.A.III.3'],
    ['0829', 'Beteiligung der GmbH & Co. KG an ihrer Komplementär-GmbH', ASSET, 'assets.A.III.3'],
    ['0830', 'Beteiligungen als typisch stiller Gesellschafter', ASSET, 'assets.A.III.3'],
    ['0840', 'Beteiligungen als atypisch stiller Gesellschafter', ASSET, 'assets.A.III.3'],
    ['0850', 'Beteiligungen in der Rechtsform einer Kapitalgesellschaft', ASSET, 'assets.A.III.3'],
    ['0860', 'Beteiligungen in der Rechtsform einer Personengesellschaft', ASSET, 'assets.A.III.3'],
    ['0880', 'Ausleihungen an Unternehmen, mit denen ein Beteiligungsverhältnis besteht', ASSET, 'assets.A.III.4'],
    ['0883', 'Ausleihungen an Personengesellschaften mit Beteiligungsverhältnis', ASSET, 'assets.A.III.4'],
    ['0885', 'Ausleihungen an Kapitalgesellschaften mit Beteiligungsverhältnis', ASSET, 'assets.A.III.4'],
    ['0900', 'Wertpapiere des Anlagevermögens', ASSET, 'assets.A.III.5'],
    ['0910', 'Wertpapiere mit Gewinnanspruch im Teileinkünfteverfahren', ASSET, 'assets.A.III.5'],
    ['0920', 'Wertpapiere mit festem Zins', ASSET, 'assets.A.III.5'],
    ['0930', 'Weitere sonstige Ausleihungen', ASSET, 'assets.A.III.6'],
    ['0940', 'Gewährte Darlehen, langfristig', ASSET, 'assets.A.III.6'],
    ['0960', 'Langfristige Ausleihungen an Gesellschafter', ASSET, 'assets.A.III.6'],
    ['0961', 'Langfristige Ausleihungen an Gesellschafter einer GmbH', ASSET, 'assets.A.III.6'],
    ['0962', 'Langfristige Ausleihungen an Vollhafter', ASSET, 'assets.A.III.6'],
    ['0963', 'Langfristige Ausleihungen an Kommanditisten', ASSET, 'assets.A.III.6'],
    ['0970', 'Langfristige Ausleihungen an nahestehende Personen', ASSET, 'assets.A.III.6'],
    // neither securities nor, by § 271 (1) sentence 5 HGB, participations: the other loans of the financial assets
    ['0980', 'Genossenschaftsanteile, langfristig gehalten', ASSET, 'assets.A.III.6'],
    ['0990', 'Ansprüche aus Rückdeckungsversicherungen, langfristig', ASSET, 'assets.A.III.6']
];