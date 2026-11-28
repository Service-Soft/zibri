import { Repository } from '../../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../../../di/decorators/injectable.decorator';
import { inject } from '../../../../di/inject.function';
import { $ts } from '../../../../localization/translate.function';
import { type BookkeepingObligation } from '../../models/bookkeeping-obligation.model';
import { type BookkeepingReopening } from '../../models/bookkeeping-reopening.model';
import { type BookkeepingReportContext } from '../../models/bookkeeping-report-context.model';
import { type NewJournalEntry } from '../../models/new-journal-entry.model';
import { type BookkeepingConformance, type BookkeepingConformanceServiceInterface } from '../../services/conformance/bookkeeping-conformance-service.interface';
import { EBilanzDeadlineUtilities } from '../e-bilanz-deadline.utilities';
import { ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS } from '../e-bilanz.tokens';
import { EBilanzUtilities } from '../e-bilanz.utilities';
import { EBilanzFilingKind } from '../models/e-bilanz-filing-kind.enum';
import { EBilanzFiling } from '../models/e-bilanz-filing.model';

/**
 * Holds a company that keeps balance sheets to § 5b EStG: the content of its balance sheet and income statement is
 * filed with the tax administration as an E-Bilanz each fiscal year. Once a fiscal year is closed, it asks for its
 * E-Bilanz to be prepared and its filing recorded, with its deadline of § 149 AO. It applies to the corporations,
 * which keep balance sheets by their legal form (§ 6 HGB, § 238 HGB, § 8 (2) KStG); a fiscal year of another company
 * that keeps them names the conformance `e-bilanz`. It refuses no closing, and refuses to reopen a fiscal year whose
 * E-Bilanz is filed unless it is reopened to correct it.
 */
@Injectable({ register: 'onUse' })
export class EBilanzConformanceService implements BookkeepingConformanceServiceInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: BookkeepingConformance = 'e-bilanz';

    /**
     * The legal forms it applies to, those keeping balance sheets whatever their size.
     */
    protected readonly legalForms: string[] = ['GmbH', 'UG', 'AG', 'KGaA', 'SE'];

    private get filingRepository(): Repository<EBilanzFiling> {
        return inject(repositoryTokenFor(EBilanzFiling));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    isApplicable(legalForm: string): boolean {
        return this.legalForms.includes(legalForm);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveClosingProposals(): NewJournalEntry[] {
        return [];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateClosing(): void {
        // the E-Bilanz states the closed fiscal year, so nothing of it is due before the closing
    }

    /**
     * Validates that a fiscal year can be reopened: one whose E-Bilanz is filed only to correct it, none while a
     * transmission of it runs or has a result that is not known.
     * @param reopening - The fiscal year being reopened.
     */
    async validateReopening(reopening: BookkeepingReopening): Promise<void> {
        await inject(ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.E_BILANZ_SERVICE).validateReopening(
            reopening.fiscalYear.id,
            reopening.forCorrection,
            reopening.transaction
        );
    }

    /**
     * Resolves the filing of the E-Bilanz of a closed fiscal year, done once it is transmitted or filed by hand. Its
     * deadline is the later one of a tax advisor only when the company of the bookkeeping settings says it has one.
     * @param context - The fiscal year.
     * @returns The obligation, none for an open fiscal year.
     */
    async resolveObligations(context: BookkeepingReportContext): Promise<BookkeepingObligation[]> {
        if (context.fiscalYear.closedAt == undefined) {
            return [];
        }
        const filings: EBilanzFiling[] = await this.filingRepository.findAll({
            where: { fiscalYearId: context.fiscalYear.id },
            order: { chainSequence: 'ASC' },
            limit: 'all'
        });
        const filed: EBilanzFiling | undefined = filings.find(f => (f.kind === EBilanzFilingKind.TRANSMISSION && f.succeeded)
            || f.kind === EBilanzFilingKind.MANUAL_FILING);
        return [
            {
                conformance: this.name,
                name: 'e-bilanz',
                description: $ts`Prepare the E-Bilanz of the fiscal year and file it with the tax administration, § 5b EStG.`,
                dueOn: EBilanzDeadlineUtilities.resolveDeadline(
                    context.fiscalYear.end,
                    EBilanzUtilities.findGermanCompany(context.settings.company)?.taxAdvisor ?? false
                ),
                fulfilledAt: filed?.createdAt ?? null
            }
        ];
    }
}