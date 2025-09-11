import { BaseEntity } from '../../entity';
import { Newable } from '../../types';

/**
 * An error to throw when there are entities that are not registered in a data source.
 */
export class MissingEntitiesError extends Error {
    constructor(context: string, orphanedEntities: Newable<BaseEntity>[]) {
        const messages: string[] = [
            `Error initializing ${context}`,
            'Could not find data source for the following entities:'
        ];
        for (const entity of orphanedEntities) {
            messages.push(`  - ${entity.name}`);
        }
        messages.push(
            'Did you forget to add it to your data source entities array?\n',

            `If you don\'t want to use "${context}" you can also provide an undefined value for the injection token of "${context}".`
        );
        super(messages.join('\n'));
        this.name = 'MissingEntitiesError';
    }
}