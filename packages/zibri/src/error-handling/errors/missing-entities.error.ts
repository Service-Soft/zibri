import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { InternalError } from '../internal-error.model';

/**
 * An error to throw when there are entities that are not registered in a data source.
 */
export class MissingEntitiesError extends InternalError {
    /**
     * @param requiredBy - Each entity no data source declares, with the names of everything that requires it.
     * @param options - The cause, if there is one.
     */
    constructor(requiredBy: Map<Newable<BaseEntity>, string[]>, options?: ErrorOptions) {
        const messages: string[] = ['Could not find a data source for the following entities:'];
        for (const [entity, names] of requiredBy) {
            messages.push(`  - ${entity.name} (required by ${MissingEntitiesError.joinNames(names)})`);
        }
        messages.push(
            'Did you forget to add them to your data source entities array?\n',
            'If you don\'t want to use something that requires one, you can also provide a variant of it that does not need it.'
        );
        super(messages, options);
        this.name = 'MissingEntitiesError';
    }

    /**
     * Joins names the way a sentence lists them: "A, B and C".
     * @param names - The names.
     * @returns The list.
     */
    private static joinNames(names: string[]): string {
        const last: string | undefined = names.at(-1);
        return names.length < 2 || last == undefined ? names.join('') : `${names.slice(0, -1).join(', ')} and ${last}`;
    }
}
