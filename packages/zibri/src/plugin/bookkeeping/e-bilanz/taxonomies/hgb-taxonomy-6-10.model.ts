/* eslint-disable cspell/spellchecker, stylistic/max-len, sonar/no-duplicate-string */
// (c) XBRL Deutschland e.V. - see http://www.xbrl.de
// Extracted from german-gaap-taxonomy-v6.10-2026-04-01.zip (SHA-256 8e5ceb61a65aa46c6b1b6d86dce2a207ebfae1fecdbb4012687ac2316b258457) by scripts/build-e-bilanz-taxonomy.mjs, and shortened:
// the positions, columns and fields a corporation reports to the tax administration. Rebuild it with the script
// rather than changing it by hand.
// Stated as what it changes of the version before it.
import { EBilanzTaxonomyUtilities } from '../e-bilanz-taxonomy.utilities';
import { type EBilanzTaxonomy } from '../models/e-bilanz-taxonomy.model';
import { HGB_TAXONOMY_6_9 } from './hgb-taxonomy-6-9.model';

/**
 * Version 6.10 of the HGB taxonomy of the E-Bilanz, of 2026-04-01, as far as a corporation reports it: the
 * positions of its statements and of the appropriation of its profits, the columns of the statement of changes in
 * fixed assets and the fields of the GCD module the tax administration asks for. © XBRL Deutschland e.V., shortened.
 */
export const HGB_TAXONOMY_6_10: EBilanzTaxonomy = EBilanzTaxonomyUtilities.resolveChanged(HGB_TAXONOMY_6_9, {
    version: '6.10',
    date: '2026-04-01',
    adapter: 'hgb-6',
    allowedFrom: new Date('2026-01-01T00:00:00.000Z'),
    mandatoryFrom: new Date('2027-01-01T00:00:00.000Z'),
    notice: '© XBRL Deutschland e.V., see http://www.xbrl.de. Shortened to what a corporation reports to the tax administration.',
    statements: {
        balanceSheet: {
            removed: ['bs.ass.fixAss.fin.loansToSharehold.gmbhSilent', 'bs.ass.fixAss.fin.otherFinAss.silent', 'bs.ass.currAss.receiv.shareholders.silent', 'bs.eqLiab.liab.shareholders.gmbhSilent'],
            rows: [
                { after: 'bs.ass.currAss.receiv.otherForeign', row: ['bs.ass.unpaidCap.dueCapOfCoop', 'bs.ass.currAss.receiv', 'D', 'R', 'Forderungen und sonstige Vermögensgegenstände, Rückständige fällige Einzahlungen auf Geschäftsanteile'] },
                { after: 'bs.eqLiab.equity.netIncome.taxBalanceGenerally', row: ['bs.eqLiab.equity.netIncome.taxBalanceGenerally.finalPrev', 'bs.eqLiab.equity.netIncome.taxBalanceGenerally', 'C', 'M', 'Eigenkapital, steuerlicher Ausgleichsposten, des letzten Stichtags'] },
                { after: 'bs.eqLiab.otherSpecRes.statutoryBoundCapital', row: ['bs.eqLiab.otherSpecRes.TEHGFreeOfCharge', 'bs.eqLiab.otherSpecRes', 'C', 'R', 'Sonstige Sonderposten, Sonderposten für unentgeltlich erworbene TEHG-Emissionsberechtigungen'] },
                { after: 'bs.eqLiab.otherSpecRes.TEHGFreeOfCharge', row: ['bs.eqLiab.otherSpecRes.THGFreeOfCharge', 'bs.eqLiab.otherSpecRes', 'C', 'R', 'Sonstige Sonderposten, Sonderposten für unentgeltlich erworbene THG-Quoten'] }
            ]
        },
        incomeStatement: {
            removed: [],
            rows: [
                { after: 'is.netIncome.regular.operatingTC.staff.social.socExp.misc', row: ['is.netIncome.regular.operatingTC.staff.social.pensions', 'is.netIncome.regular.operatingTC.staff.social', 'D', 'S', 'soziale Abgaben und Aufwendungen für Altersversorgung und für Unterstützung (GKV), davon für Altersversorgung'] },
                { after: 'is.netIncome.regular.operatingTC.staff.social.pensions', row: ['is.netIncome.regular.operatingTC.staff.social.pensions.shareholderManager', 'is.netIncome.regular.operatingTC.staff.social.pensions', 'D', 'M', 'soziale Abgaben und Aufwendungen für Altersversorgung und für Unterstützung (GKV), davon für Altersversorgung, für Gesellschafter-Geschäftsführer'] },
                { after: 'is.netIncome.regular.operatingTC.staff.social.pensions.shareholderManager', row: ['is.netIncome.regular.operatingTC.staff.social.pensions.other', 'is.netIncome.regular.operatingTC.staff.social.pensions', 'D', 'M', 'soziale Abgaben und Aufwendungen für Altersversorgung und für Unterstützung (GKV), davon für Altersversorgung, für übrige Arbeitnehmer'] },
                { after: 'is.netIncome.regular.operatingTC.staff.social.pensions.other', row: ['is.netIncome.regular.operatingTC.staff.social.pensions.misc', 'is.netIncome.regular.operatingTC.staff.social.pensions', 'D', 'R', 'soziale Abgaben und Aufwendungen für Altersversorgung und für Unterstützung (GKV), davon für Altersversorgung, nicht zuordenbar'] },
                { after: 'is.netIncome.regular.fin.netInterest.income.negCapitalTransferFee', row: ['is.netIncome.regular.fin.netInterest.income.valueDiscount', 'is.netIncome.regular.fin.netInterest.income', 'C', 'M', 'sonstige Zinsen und ähnliche Erträge, davon Erträge aus der Abzinsung'] },
                { after: 'is.netIncome.regular.fin.netInterest.expenses', row: ['is.netIncome.regular.fin.netInterest.expenses.valueDiscount', 'is.netIncome.regular.fin.netInterest.expenses', 'D', 'M', 'Zinsen und ähnliche Aufwendungen, davon Aufwendungen aus der Abzinsung'] },
                { after: 'is.netIncome.regular.fin.netInterest.expenses.loanFees', row: ['is.netIncome.regular.fin.netInterest.expenses.other', 'is.netIncome.regular.fin.netInterest.expenses', 'D', 'R', 'Zinsen und ähnliche Aufwendungen, übrige Zinsen und ähnliche Aufwendungen'] },
                { after: 'is.netIncome.tax.otherIncomeTaxes', row: ['is.netIncome.otherTaxes', 'is.netIncome', 'D', 'S', 'sonstige Steuern', ['is.netIncome.otherTaxes.vatEtc', '-is.netIncome.otherTaxes.releaseTaxProvision', 'is.netIncome.otherTaxes.GrSt', 'is.netIncome.otherTaxes.other']] },
                { after: 'is.netIncome.otherTaxes', row: ['is.netIncome.otherTaxes.vatEtc', 'is.netIncome.otherTaxes', 'D', 'R', 'sonstige Steuern, in den Umsatzerlösen enthaltene Monopolabgaben und sonstige direkt mit dem Umsatz verbundene Steuern'] },
                { after: 'is.netIncome.otherTaxes.vatEtc', row: ['is.netIncome.otherTaxes.releaseTaxProvision', 'is.netIncome.otherTaxes', 'C', 'R', 'sonstige Steuern, Erträge aus der Auflösung von Steuerrückstellungen'] },
                { after: 'is.netIncome.otherTaxes.releaseTaxProvision', row: ['is.netIncome.otherTaxes.GrSt', 'is.netIncome.otherTaxes', 'D', 'M', 'sonstige Steuern, Grundsteuer'] },
                { after: 'is.netIncome.otherTaxes.GrSt', row: ['is.netIncome.otherTaxes.other', 'is.netIncome.otherTaxes', 'D', 'R', 'sonstige Steuern, übrige sonstige Steuern'] }
            ]
        },
        microIncomeStatement: {
            removed: [],
            rows: []
        },
        appropriationOfProfits: {
            removed: [],
            rows: [
                { after: null, row: ['incomeUse.gainLoss', null, 'C', 'S', 'Bilanzgewinn / Bilanzverlust (GuV)', ['incomeUse.gainLoss.netIncome', 'incomeUse.gainLoss.releaseCapReserves', 'incomeUse.gainLoss.releaseRevenReserves', 'incomeUse.gainLoss.releaseCapital', '-incomeUse.gainLoss.releaseCapitalReserve', '-incomeUse.gainLoss.additionRevenReserves', 'incomeUse.gainLoss.DeprPaidUpShares', '-incomeUse.gainLoss.replentishmentPaidupShares', 'incomeUse.gainLoss.retainedEarningsPrevYear', '-incomeUse.gainLoss.accumLossPrevYear', '-incomeUse.gainLoss.dividensPlanned', '-incomeUse.gainLoss.additionRetainedEarnings', 'incomeUse.gainLoss.additionCummLoss', '-incomeUse.gainLoss.assReductionSpinOff']] },
                { after: 'incomeUse.gainLoss.releaseCapReserves', row: ['incomeUse.gainLoss.releaseRevenReserves', 'incomeUse.gainLoss', 'C', 'S', 'Bilanzgewinn / Bilanzverlust (GuV), Entnahmen aus Gewinnrücklagen/Ergebnisrücklagen'] },
                { after: 'incomeUse.gainLoss.releaseRevenReserves', row: ['incomeUse.gainLoss.releaseRevenReserves.legalRes', 'incomeUse.gainLoss.releaseRevenReserves', 'C', 'M', 'Bilanzgewinn / Bilanzverlust (GuV), Entnahmen aus Gewinnrücklagen/Ergebnisrücklagen, Entnahmen aus der gesetzlichen Rücklage'] },
                { after: 'incomeUse.gainLoss.releaseRevenReserves.legalRes', row: ['incomeUse.gainLoss.releaseRevenReserves.sharesParentCompRes', 'incomeUse.gainLoss.releaseRevenReserves', 'C', 'R', 'Bilanzgewinn / Bilanzverlust (GuV), Entnahmen aus Gewinnrücklagen/Ergebnisrücklagen, Entnahmen aus der Rücklage für Anteile an einem herrschenden oder mehrheitlich beteiligten Unternehmen'] },
                { after: 'incomeUse.gainLoss.releaseRevenReserves.sharesParentCompRes', row: ['incomeUse.gainLoss.releaseRevenReserves.statRes', 'incomeUse.gainLoss.releaseRevenReserves', 'C', 'M', 'Bilanzgewinn / Bilanzverlust (GuV), Entnahmen aus Gewinnrücklagen/Ergebnisrücklagen, Entnahmen aus satzungsmäßigen Rücklagen'] },
                { after: 'incomeUse.gainLoss.releaseRevenReserves.statRes', row: ['incomeUse.gainLoss.releaseOtherRes', 'incomeUse.gainLoss.releaseRevenReserves', 'C', 'M', 'Bilanzgewinn / Bilanzverlust (GuV), Entnahmen aus Gewinnrücklagen/Ergebnisrücklagen, Entnahmen aus anderen Gewinnrücklagen'] },
                { after: 'incomeUse.gainLoss.releaseOtherRes', row: ['incomeUse.gainLoss.releaseRevenReserves.RevRes', 'incomeUse.gainLoss.releaseRevenReserves', 'C', 'R', 'Bilanzgewinn / Bilanzverlust (GuV), Entnahmen aus Gewinnrücklagen/Ergebnisrücklagen, Entnahmen aus anderen Ergebnisrücklagen'] },
                { after: 'incomeUse.gainLoss.releaseCapitalReserve', row: ['incomeUse.gainLoss.additionRevenReserves', 'incomeUse.gainLoss', 'D', 'S', 'Bilanzgewinn / Bilanzverlust (GuV), Einstellungen in Gewinnrücklagen/Ergebnisrücklagen'] },
                { after: 'incomeUse.gainLoss.additionRevenReserves', row: ['incomeUse.gainLoss.additionRevenReserves.legalRes', 'incomeUse.gainLoss.additionRevenReserves', 'D', 'M', 'Bilanzgewinn / Bilanzverlust (GuV), Einstellungen in Gewinnrücklagen/Ergebnisrücklagen, Einstellungen in die gesetzliche Rücklage'] },
                { after: 'incomeUse.gainLoss.additionRevenReserves.legalRes', row: ['incomeUse.gainLoss.additionRevenReserves.sharesParentCompRes', 'incomeUse.gainLoss.additionRevenReserves', 'D', 'R', 'Bilanzgewinn / Bilanzverlust (GuV), Einstellungen in Gewinnrücklagen/Ergebnisrücklagen, Einstellungen in die Rücklage für Anteile an einem herrschenden oder mehrheitlich beteiligten Unternehmen'] },
                { after: 'incomeUse.gainLoss.additionRevenReserves.sharesParentCompRes', row: ['incomeUse.gainLoss.additionRevenReserves.statRes', 'incomeUse.gainLoss.additionRevenReserves', 'D', 'M', 'Bilanzgewinn / Bilanzverlust (GuV), Einstellungen in Gewinnrücklagen/Ergebnisrücklagen, Einstellungen in die satzungsmäßigen Rücklagen'] },
                { after: 'incomeUse.gainLoss.additionRevenReserves.statRes', row: ['incomeUse.gainLoss.additionOtherRes', 'incomeUse.gainLoss.additionRevenReserves', 'D', 'M', 'Bilanzgewinn / Bilanzverlust (GuV), Einstellungen in Gewinnrücklagen/Ergebnisrücklagen, Einstellungen in andere Gewinnrücklagen'] },
                { after: 'incomeUse.gainLoss.additionOtherRes', row: ['incomeUse.gainLoss.additionRevenReserves.RevRes', 'incomeUse.gainLoss.additionRevenReserves', 'D', 'R', 'Bilanzgewinn / Bilanzverlust (GuV), Einstellungen in Gewinnrücklagen/Ergebnisrücklagen, Einstellungen in andere Ergebnisrücklagen'] }
            ]
        },
        businessAssetComparison: {
            removed: [],
            rows: []
        }
    },
    fixedAssetColumns: [
        ['all', null, 'S', 'Buchwert zum Ende der Periode', ['gross', '-accDepr', 'revaluation']],
        ['gross', 'all', 'S', 'Anschaffungs- und Herstellungskosten zum Ende der Periode', ['grossCost.beginning', 'gross.diff', 'gross.addition', '-gross.release', 'gross.movements', 'gross.currChanges']],
        ['grossCost.beginning', 'gross', 'M', 'Anschaffungs- und Herstellungskosten zum Anfang der Periode'],
        ['gross.diff', 'gross', 'R', 'Anschaffungs- und Herstellungskosten, Differenzen zum Endstand Vorperiode'],
        ['gross.diff.currDiff', 'gross.diff', null, 'Anschaffungs- und Herstellungskosten, Währungsdifferenzen gegenüber Endstand Vorperiode'],
        ['gross.diff.otherDiff', 'gross.diff', null, 'Anschaffungs- und Herstellungskosten, andere Differenzen gegenüber Endstand Vorperiode'],
        ['gross.addition', 'gross', 'M', 'Anschaffungs- und Herstellungskosten, Zugänge', []],
        ['gross.addition.interest', 'gross.addition', null, 'Anschaffungs- und Herstellungskosten, Zugänge, davon aktivierte Zinsen für Fremdkapital'],
        ['gross.release', 'gross', 'R', 'Anschaffungs- und Herstellungskosten, Abgänge'],
        ['gross.movements', 'gross', 'M', 'Anschaffungs- und Herstellungskosten, Umbuchungen'],
        ['gross.currChanges', 'gross', 'R', 'Anschaffungs- und Herstellungskosten, Änderung durch Währungsdifferenzen'],
        ['accDepr', 'all', 'S', 'Kumulierte Abschreibungen zum Ende der Periode', ['accDepr.beginning', 'accDepr.diff', 'accDepr.DeprPeriod', 'accDepr.addition', '-accDepr.release', 'accDepr.movements', 'accDepr.currChanges']],
        ['accDepr.beginning', 'accDepr', 'M', 'Kumulierte Abschreibungen zum Anfang der Periode'],
        ['accDepr.diff', 'accDepr', 'R', 'Kumulierte Abschreibungen, Differenzen zum Endstand Vorperiode'],
        ['accDepr.diff.currDiff', 'accDepr.diff', null, 'Kumulierte Abschreibungen, Währungsdifferenzen gegenüber Endstand Vorperiode'],
        ['accDepr.diff.otherDiff', 'accDepr.diff', null, 'Kumulierte Abschreibungen, andere Differenzen gegenüber Endstand Vorperiode'],
        ['accDepr.DeprPeriod', 'accDepr', 'S', 'Abschreibungen, Sonderabschreibungen und sonstige Abzüge der Periode'],
        ['accDepr.DeprPeriod.regular', 'accDepr.DeprPeriod', 'M', 'Abschreibungen, Sonderabschreibungen und sonstige Abzüge der Periode, planmäßige Abschreibung'],
        ['accDepr.DeprPeriod.extraordinary', 'accDepr.DeprPeriod', 'M', 'Abschreibungen, Sonderabschreibungen und sonstige Abzüge der Periode, außerplanmäßige Abschreibung'],
        ['accDepr.DeprPeriod.impairment', 'accDepr.DeprPeriod', 'M', 'Abschreibungen, Sonderabschreibungen und sonstige Abzüge der Periode, Sonderabschreibung'],
        ['accDepr.DeprPeriod.EStG7g_2', 'accDepr.DeprPeriod', 'M', 'Abschreibungen, Sonderabschreibungen und sonstige Abzüge der Periode, Herabsetzungsbetrag nach § 7g Abs. 2 EStG'],
        ['accDepr.DeprPeriod.EStG6b_3', 'accDepr.DeprPeriod', 'M', 'Abschreibungen, Sonderabschreibungen und sonstige Abzüge der Periode, Abzugsbetrag nach § 6b EStG'],
        ['accDepr.DeprPeriod.misc', 'accDepr.DeprPeriod', 'R', 'Abschreibungen, Sonderabschreibungen und sonstige Abzüge der Periode, AfA nicht zuordenbar'],
        ['accDepr.addition', 'accDepr', 'M', 'Kumulierte Abschreibungen, erfolgsneutrale Zugänge'],
        ['accDepr.release', 'accDepr', 'M', 'Kumulierte Abschreibungen, erfolgsneutrale Abgänge'],
        ['accDepr.movements', 'accDepr', 'M', 'Kumulierte Abschreibungen, Umbuchungen'],
        ['accDepr.currChanges', 'accDepr', 'R', 'Kumulierte Abschreibungen, Änderung durch Währungsdifferenzen'],
        ['revaluation', 'all', 'M', 'Zuschreibungen']
    ],
    gcdFields: [
        ['genInfo.report.id.reportStatus', 'M', 'Fertigstellungsstatus des Berichts'],
        ['genInfo.report.id.reportElement', 'M', 'Berichtsbestandteile'],
        ['genInfo.report.id.reportElement.reportElements.B', 'M', 'Berichtsbestandteile, Bilanz'],
        ['genInfo.report.id.reportElement.reportElements.GuV', 'M', 'Berichtsbestandteile, GuV'],
        ['genInfo.report.id.reportElement.reportElements.BAL', 'M', 'Berichtsbestandteile, Anlagenspiegel (brutto)'],
        ['genInfo.report.id.reportElement.reportElements.STU', 'M', 'Berichtsbestandteile, steuerliche Überleitungsrechnung'],
        ['genInfo.report.id.reportElement.reportElements.EB', 'M', 'Berichtsbestandteile, Eröffnungsbilanz ohne GuV'],
        ['genInfo.report.id.reportElement.reportElements.EV', 'M', 'Berichtsbestandteile, Ergebnisverwendung'],
        ['genInfo.report.id.reportElement.reportElements.KS', 'M', 'Berichtsbestandteile, Kontensalden zu einer oder mehreren Positionen'],
        ['genInfo.report.id.reportElement.reportElements.BVV', 'M', 'Berichtsbestandteile, Steuerlicher Betriebsvermögensvergleich'],
        ['genInfo.report.id.statementType', 'M', 'Bilanzart'],
        ['genInfo.report.id.accountingStandard', 'M', 'Bilanzierungsstandard'],
        ['genInfo.report.id.incomeStatementFormat', 'M', 'GuV Format'],
        ['genInfo.report.id.consolidationRange', 'M', 'Konsolidierungsumfang'],
        ['genInfo.report.id.revisionStatus', 'M', 'Status des Berichts'],
        ['genInfo.report.id.incomeStatementendswithBalProfit', 'M', 'Bilanz enthält Ausweis des Bilanzgewinns/Bilanzverlustes'],
        ['genInfo.report.id.accordingTo', 'M', 'Bericht gehört zu'],
        ['genInfo.report.id.accordingTo.name', 'M', 'Name Gesamthand'],
        ['genInfo.report.id.accordingTo.idNo', 'M', 'Unternehmenskennnummern, Gesamthand'],
        ['genInfo.company.id.idNo.type.companyId.ST13', 'M', '13stellige Steuernummer'],
        ['genInfo.company.id.idNo.type.companyId.STWID', 'M', '17stellige steuerliche W-IdNr.'],
        ['genInfo.company.id.idNo.type.companyId.BF4', 'M', '4stellige Bundesfinanzamtsnummer'],
        ['genInfo.report.id.accordingTo.yearEnd', 'M', 'Abschlussstichtag, Gesamthand'],
        ['genInfo.report.id.specialAccountingStandard', 'M', 'Branchen'],
        ['genInfo.report.period.fiscalYearBegin', 'M', 'Beginn des Wirtschaftsjahres'],
        ['genInfo.report.period.fiscalYearEnd', 'M', 'Ende des Wirtschaftsjahres'],
        ['genInfo.report.period.balSheetClosingDate', 'M', 'Bilanzstichtag'],
        ['genInfo.report.period.fiscalPreviousYearBegin', 'M', 'Beginn des Wirtschaftsjahres (Vorjahr)'],
        ['genInfo.report.period.fiscalPreviousYearEnd', 'M', 'Ende des Wirtschaftsjahres (Vorjahr)'],
        ['genInfo.report.period.balSheetClosingDatePreviousYear', 'M', 'Bilanzstichtag (Vorjahr)'],
        ['genInfo.company.id.name', 'M', 'Name des Unternehmens'],
        ['genInfo.company.id.legalStatus', 'M', 'Rechtsform'],
        ['genInfo.company.id.location.street', 'M', 'Firmensitz, Straße'],
        ['genInfo.company.id.location.houseNo', 'M', 'Firmensitz, Hausnummer'],
        ['genInfo.company.id.location.zipCode', 'M', 'Firmensitz, Postleitzahl'],
        ['genInfo.company.id.location.city', 'M', 'Firmensitz, Ort'],
        ['genInfo.company.id.location.country', 'M', 'Firmensitz, Land'],
        ['genInfo.company.id.business', 'M', 'Geschäftstätigkeit'],
        ['genInfo.company.id.shareholder', 'M', 'Gesellschafter/(Sonder-) Mitunternehmer'],
        ['genInfo.company.id.shareholder.name', 'M', 'Name des Gesellschafters'],
        ['genInfo.company.id.shareholder.taxnumber', 'M', '13stellige Steuernummer des Gesellschafters'],
        ['genInfo.company.id.shareholder.taxid', 'M', 'steuerliche IDNr. des Gesellschafters'],
        ['genInfo.company.id.shareholder.ShareDivideKey', 'M', 'Beteiligungsschlüssel Gesellschafter'],
        ['genInfo.company.id.shareholder.WID', 'M', '17stellige steuerliche W-IdNr. des Gesellschafters'],
        ['genInfo.company.id.shareholder.legalStatus', 'M', 'Rechtsform des Gesellschafters'],
        ['genInfo.company.id.shareholder.id', 'M', 'Gesellschafterschlüssel, unternehmensbezogenes / betriebsinternes Zuordnungsmerkmal'],
        ['genInfo.company.id.idNo', 'M', 'Unternehmenskennnummern'],
        ['genInfo.company.id.idNo.type.companyId.STID', 'M', 'steuerliche IdNr.'],
        ['genInfo.company.id.entityWithTaxablePurposeBusiness', 'M', 'Unternehmen mit Gewinnermittlung für besondere Fälle'],
        ['genInfo.company.id.domesticBranchOfForeignCompany', 'M', 'Inländische Betriebsstätte eines ausländischen Unternehmens'],
        ['genInfo.company.id.incomeClassification', 'M', 'Zuordnung zur Einkunftsart']
    ]
});