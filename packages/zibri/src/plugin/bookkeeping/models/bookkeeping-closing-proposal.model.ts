import { Property } from '../../../entity/decorators/property.decorator';
import { NewJournalEntry } from './new-journal-entry.model';

/**
 * An entry a conformance proposes to post before a fiscal year is closed, such as the legal reserve of a company.
 * Post it with `post` of the journal service, or `POST /entries`, once it is reviewed.
 */
export class BookkeepingClosingProposal {
    /**
     * The name of the conformance proposing it.
     */
    @Property.string()
    conformance!: string;

    /**
     * The entry, as `post` takes it.
     */
    @Property.object({ cls: () => NewJournalEntry })
    entry!: NewJournalEntry;
}