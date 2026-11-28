import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ArchiveOptions } from '../archive-options.model';
import { ArchiveUtilities } from '../archive.utilities';
import { type BaseArchivedEntity } from '../base-archived-entity.model';

/**
 * Archives the rows of an entity, a type of document such as a receipt: each row and its files are kept unchanged for
 * its retention, and may be deleted once it ends. The entity is declared with `@Entity({ chained: true })` and extends
 * `BaseArchivedEntity`.
 * @param options - How long each row is kept, from when, and where else its files are kept.
 * @returns The decorator.
 */
// `const`, so that the date property named keeps its literal type, which the class is checked to declare as a date
export function Archive<const TDateKey extends string = never>(options: ArchiveOptions<TDateKey>) {
    ArchiveUtilities.validateRetention(options.retention);
    return <T extends BaseArchivedEntity & Record<TDateKey, Date>>(target: Newable<T>): void => {
        MetadataUtilities.setArchiveMetadata(target, {
            retention: options.retention,
            from: options.from ?? 'endOfYear',
            dateProperty: options.dateProperty,
            copies: options.copies ?? []
        });
    };
}