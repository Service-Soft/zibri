import { type PdfDocumentDefinition } from '../../../../document/pdf.utilities';
import { type BookkeepingClosing } from '../../models/bookkeeping-closing.model';
import { type BookkeepingObligation } from '../../models/bookkeeping-obligation.model';
import { type BookkeepingReopening } from '../../models/bookkeeping-reopening.model';
import { type BookkeepingReportContext } from '../../models/bookkeeping-report-context.model';
import { type BookkeepingSettingsCreateData } from '../../models/bookkeeping-settings.model';
import { type BookkeepingStatementForms } from '../../models/bookkeeping-statement-forms.model';
import { type BookkeepingStatement } from '../../models/bookkeeping-statement.model';
import { type NewJournalEntry } from '../../models/new-journal-entry.model';
import { type PostingRules } from '../../models/posting-rules.model';

/**
 * The name of a conformance, such as the rules of a law for companies of a legal form.
 * Is loosely typed so that a custom string can be provided.
 */
export type BookkeepingConformance = string & {};

/**
 * A service that holds the books of a tenant to the rules of a law, such as those of a legal form, beyond what
 * double-entry bookkeeping asks. It applies to a fiscal year by the legal form the tenant has at the end of it,
 * unless the fiscal year names its conformances.
 */
export interface BookkeepingConformanceServiceInterface {
    /**
     * The name of the conformance, which a fiscal year names to apply it.
     */
    readonly name: BookkeepingConformance,
    /**
     * Whether the conformance applies to a tenant of a legal form, such as `UG`.
     */
    isApplicable: (legalForm: string) => boolean,
    /**
     * Resolves the entries to post before the fiscal year is closed, such as the legal reserve of the result. They
     * are posted by the application, once reviewed, and none when the fiscal year needs none.
     */
    resolveClosingProposals: (closing: BookkeepingClosing) => NewJournalEntry[] | Promise<NewJournalEntry[]>,
    /**
     * Validates that the fiscal year can be closed, such as that the entries proposed are posted. Called while it is
     * closed, in the transaction it is closed in.
     * @throws An error saying what needs to be posted first, which refuses the closing.
     */
    validateClosing: (closing: BookkeepingClosing) => void | Promise<void>,
    /**
     * Validates that a closed fiscal year it applies to can be reopened to correct its books, such as that its
     * accounts are not filed yet. Called before anything of it is reversed, in the transaction it is reopened in.
     * @throws An error saying why it cannot be reopened, which refuses the reopening.
     */
    validateReopening?: (reopening: BookkeepingReopening) => void | Promise<void>,
    /**
     * Resolves the forms the statements of the fiscal year are in by default, such as the shortened ones of a small
     * company, or undefined to leave them to the next conformance. The full structures of the
     * `STATEMENT_STRUCTURES` when no conformance answers.
     * @throws An error saying what the fiscal year needs, which refuses a statement in its default form.
     */
    resolveStatementForms?: (
        context: BookkeepingReportContext
    ) => BookkeepingStatementForms | undefined | Promise<BookkeepingStatementForms | undefined>,
    /**
     * Updates the pdf of a balance sheet or an income statement of the fiscal year, such as with a note below the
     * balance sheet.
     */
    updateReportDefinition?: (
        statement: BookkeepingStatement,
        definition: PdfDocumentDefinition,
        context: BookkeepingReportContext
    ) => void | Promise<void>,
    /**
     * Validates the settings of the books of a tenant of a legal form it applies to, once for each legal form of their
     * history, as they are created or changed, such as that a corporation names its register.
     * @throws An error saying what the settings need, which refuses them.
     */
    validateSettings?: (settings: BookkeepingSettingsCreateData, legalForm: string) => void | Promise<void>,
    /**
     * Validates posting rules of a fiscal year it applies to as they are saved, and the rule sets of the fiscal years
     * a legal form appended applies to, such as that the rules of a UG name the accounts of its legal reserve.
     * @throws An error saying what the rules need, which refuses them.
     */
    validatePostingRules?: (rules: PostingRules, context: BookkeepingReportContext) => void | Promise<void>,
    /**
     * Resolves what the conformance asks of a closed fiscal year it applies to, such as filing its E-Bilanz, each with
     * its deadline and whether it is done.
     */
    resolveObligations?: (context: BookkeepingReportContext) => BookkeepingObligation[] | Promise<BookkeepingObligation[]>
}
