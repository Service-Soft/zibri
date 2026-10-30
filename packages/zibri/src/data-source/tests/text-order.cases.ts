import { beforeEach, describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { Repository } from '../repository/repository';

// evaluation/round-2/11-unread-code-review.md S8: the in memory data source ordered text by the
// machine's locale rather than by the application's default locale. S10: postgres compared a text
// inside a json value by the database's collation rather than by the one its text columns have

/**
 * The spelling of a word in a glossary, stored inside the word's json value.
 */
export class GlossarySpelling {
    /**
     * The word as it is spelled.
     */
    @Property.string()
    text!: string;
}

/**
 * A word of a glossary, which is read in order.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class GlossaryWord extends BaseEntity {
    /**
     * The word.
     */
    @Property.string()
    text!: string;

    /**
     * The word again, inside a json value.
     */
    @Property.object({ cls: () => GlossarySpelling })
    spelling!: GlossarySpelling;
}

/**
 * Runs the cases about ordering text against one data source, in an application whose default
 * locale is `sv-SE`: Swedish sorts `ä` after `z`, where English sorts it with `a`.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param dataSourceOf - Reads the data source, once it is started.
 */
export function describeTextOrder(dataSourceName: string, dataSourceOf: () => DataSourceInterface): void {
    describe(`ordering text on ${dataSourceName}`, () => {
        let words: Repository<GlossaryWord>;

        beforeEach(async () => {
            words = dataSourceOf().getRepository(GlossaryWord);
            await words.deleteAll({});
            await words.createAll(['zebra', 'äpple', 'apple'].map(text => ({ text, spelling: { text } })));
        }, 30000);

        it('orders text the way the default locale sorts it', async () => {
            const ordered: GlossaryWord[] = await words.findAll({ order: { text: 'ASC' } });

            expect(ordered.map(w => w.text)).toEqual(['apple', 'zebra', 'äpple']);
        }, 30000);

        it('compares a text the way the default locale sorts it, inside a json value too', async () => {
            const afterZebra: GlossaryWord[] = await words.findAll({ where: { text: { after: 'zebra' } } });
            const spelledAfterZebra: GlossaryWord[] = await words.findAll({ where: { spelling: { where: { text: { after: 'zebra' } } } } });

            expect(afterZebra.map(w => w.text)).toEqual(['äpple']);
            expect(spelledAfterZebra.map(w => w.text)).toEqual(['äpple']);
        }, 30000);
    });
}