import { RelatedRowsReader } from './related-rows-reader.interface';
import { BaseEntity } from '../../entity/base-entity.model';
import { PropertyMetadata, RelationMetadata } from '../../entity/decorators/property.decorator';
import { RelationTree } from '../../entity/models/entity-relations.model';
import { isRelationMetadata } from '../../entity/models/is-relation-metadata.function';
import { Relation } from '../../entity/models/relation.enum';
import { InternalError } from '../../error-handling/internal-error.model';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { RelatedNarrowing } from '../models/related-narrowing.model';
import { RelatedNarrowingUtilities } from '../scopes/related-narrowing.utilities';
import { ScopedWhere } from '../scopes/scope-where.utilities';
import { Transaction } from '../transaction/transaction.model';

/**
 * Resolves the relations of rows a driver read, for every store that reads related rows as rows of
 * their own entity.
 *
 * One read per relation for all of the rows rather than one per row, each read narrowed to the rows
 * the caller may see of the related entity - so a relation holds the same rows on every store, and
 * the rows below it are resolved and narrowed the same way in turn.
 */
export abstract class RelationResolutionUtilities {

    /**
     * Resolves the given relations on the given rows, changing them in place.
     * @param entityClass - The entity of the rows.
     * @param entities - The rows.
     * @param relations - The relations to resolve, and those to resolve below each of them.
     * @param related - What the rows each relation reaches are narrowed to.
     * @param transaction - The transaction to read through.
     * @param reader - How the related rows are read.
     */
    static async resolveOn<T extends BaseEntity>(
        entityClass: Newable<T>,
        entities: T[],
        relations: RelationTree,
        related: RelatedNarrowing | undefined,
        transaction: Transaction | undefined,
        reader: RelatedRowsReader
    ): Promise<void> {
        if (!entities.length) {
            return;
        }
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        await Promise.all([...relations].map(async ([key, below]) => {
            const metadata: PropertyMetadata | undefined = properties[key];
            if (!isRelationMetadata(metadata)) {
                return;
            }
            const resolved: Map<string, unknown> = await this.resolveOne(
                entityClass,
                entities,
                key,
                metadata,
                below,
                related,
                transaction,
                reader
            );
            for (const entity of entities) {
                // a copy for each row: rows sharing a related row would otherwise share one object, and
                // the hooks a row goes through on its way out change it in place
                (entity as Record<string, unknown>)[key] = ObjectUtilities.copyDeep(resolved.get(String(entity.id)));
            }
        }));
    }

    /**
     * Reads what one relation holds for each of the given rows.
     * @param entityClass - The entity of the rows.
     * @param entities - The rows.
     * @param key - The relation's property.
     * @param metadata - The relation's metadata.
     * @param below - The relations to resolve on what it holds.
     * @param related - What the rows it reaches are narrowed to.
     * @param transaction - The transaction to read through.
     * @param reader - How the related rows are read.
     * @returns What the relation holds, by the id of the row holding it: a row or undefined for a
     * relation to one row, a list for one to many.
     */
    private static async resolveOne<T extends BaseEntity>(
        entityClass: Newable<T>,
        entities: T[],
        key: string,
        metadata: RelationMetadata<BaseEntity>,
        below: RelationTree,
        related: RelatedNarrowing | undefined,
        transaction: Transaction | undefined,
        reader: RelatedRowsReader
    ): Promise<Map<string, unknown>> {
        switch (metadata.type) {
            case Relation.MANY_TO_ONE:
            case Relation.BELONGS_TO_ONE: {
                return await this.resolveToOne(entityClass, entities, key, metadata, below, related, transaction, reader);
            }
            case Relation.ONE_TO_MANY:
            case Relation.HAS_ONE: {
                const owned: Map<string, BaseEntity[]> = await this.resolveOwned(
                    entityClass,
                    entities,
                    key,
                    metadata,
                    below,
                    related,
                    transaction,
                    reader
                );
                return metadata.type === Relation.HAS_ONE
                    ? new Map([...owned].map(([id, rows]) => [id, rows.at(0)]))
                    : owned;
            }
            case Relation.MANY_TO_MANY: {
                return await this.resolveManyToMany(entities, key, metadata, below, related, transaction, reader);
            }
        }
    }

    /**
     * Reads the row a to one relation points at, for each of the given rows.
     * @param entityClass - The entity of the rows.
     * @param entities - The rows.
     * @param key - The relation's property.
     * @param metadata - The relation's metadata.
     * @param below - The relations to resolve on the rows pointed at.
     * @param related - What the rows it reaches are narrowed to.
     * @param transaction - The transaction to read through.
     * @param reader - How the related rows are read.
     * @returns The row pointed at, by the id of the row pointing. Undefined for a row pointing at
     * nothing, or at a row the caller may not see.
     * @throws When the relation declares no join column.
     */
    private static async resolveToOne<T extends BaseEntity>(
        entityClass: Newable<T>,
        entities: T[],
        key: string,
        metadata: RelationMetadata<BaseEntity>,
        below: RelationTree,
        related: RelatedNarrowing | undefined,
        transaction: Transaction | undefined,
        reader: RelatedRowsReader
    ): Promise<Map<string, unknown>> {
        const joinColumn: string | undefined = this.joinColumnOf(metadata);
        if (joinColumn == undefined) {
            throw new InternalError(`The relation "${entityClass.name}.${key}" holds no foreign key of its own.`);
        }
        const foreignKeys: Map<string, string> = new Map();
        for (const entity of entities) {
            const foreignKey: unknown = (entity as Record<string, unknown>)[joinColumn];
            if (foreignKey != undefined) {
                // eslint-disable-next-line typescript/no-base-to-string
                foreignKeys.set(String(entity.id), String(foreignKey));
            }
        }
        const targets: Map<string, BaseEntity> = await this.readByIds(
            metadata.target(),
            [...new Set(foreignKeys.values())],
            below,
            related,
            transaction,
            reader
        );
        return new Map([...foreignKeys].map(([id, foreignKey]) => [id, targets.get(foreignKey)]));
    }

    /**
     * Reads the rows of a one to many or has one relation, for each of the given rows.
     * @param entityClass - The entity of the rows.
     * @param entities - The rows owning them.
     * @param key - The relation's property.
     * @param metadata - The relation's metadata.
     * @param below - The relations to resolve on the owned rows.
     * @param related - What the rows it reaches are narrowed to.
     * @param transaction - The transaction to read through.
     * @param reader - How the related rows are read.
     * @returns The owned rows, by the id of their owner. Every owner is in it, one owning nothing
     * the caller may see with none.
     * @throws When the relation names an inverse side its target does not declare.
     */
    private static async resolveOwned<T extends BaseEntity>(
        entityClass: Newable<T>,
        entities: T[],
        key: string,
        metadata: RelationMetadata<BaseEntity>,
        below: RelationTree,
        related: RelatedNarrowing | undefined,
        transaction: Transaction | undefined,
        reader: RelatedRowsReader
    ): Promise<Map<string, BaseEntity[]>> {
        const target: Newable<BaseEntity> = metadata.target();
        const inverse: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(target)[metadata.inverseSide];
        const foreignKeyColumn: string | undefined = this.joinColumnOf(inverse);
        if (foreignKeyColumn == undefined) {
            throw new InternalError(
                `Could not find the inverse relation "${metadata.inverseSide}" with a join column on ${target.name}`
                + ` for ${entityClass.name}.${key}.`
            );
        }
        const byOwner: Map<string, BaseEntity[]> = new Map(entities.map(e => [String(e.id), []]));
        const narrowed: ScopedWhere<BaseEntity> = RelatedNarrowingUtilities.narrow(
            { [foreignKeyColumn]: { oneOf: entities.map(e => e.id) } },
            target,
            related
        );
        if (narrowed.matchesNothing || narrowed.where == undefined) {
            return byOwner;
        }
        for (const row of await reader.findRelated(target, narrowed.where, below, related, transaction)) {
            byOwner.get(String(Reflect.get(row, foreignKeyColumn)))?.push(row);
        }
        return byOwner;
    }

    /**
     * Reads the rows of a many to many relation, for each of the given rows.
     * @param entities - The rows.
     * @param key - The relation's property.
     * @param metadata - The relation's metadata.
     * @param below - The relations to resolve on the related rows.
     * @param related - What the rows it reaches are narrowed to.
     * @param transaction - The transaction to read through.
     * @param reader - How the related rows are read.
     * @returns The related rows the caller may see, in the order the relation holds them, by the id
     * of the row relating them.
     */
    private static async resolveManyToMany<T extends BaseEntity>(
        entities: T[],
        key: string,
        metadata: RelationMetadata<BaseEntity>,
        below: RelationTree,
        related: RelatedNarrowing | undefined,
        transaction: Transaction | undefined,
        reader: RelatedRowsReader
    ): Promise<Map<string, BaseEntity[]>> {
        const idLists: string[][] = await reader.findRelatedIds(entities, key, metadata, transaction);
        const targets: Map<string, BaseEntity> = await this.readByIds(
            metadata.target(),
            [...new Set(idLists.flat())],
            below,
            related,
            transaction,
            reader
        );
        return new Map(entities.map((entity, i) => [
            String(entity.id),
            (idLists[i] ?? []).flatMap(id => {
                const target: BaseEntity | undefined = targets.get(id);
                return target == undefined ? [] : [target];
            })
        ]));
    }

    /**
     * The column a to one relation stores its foreign key in.
     * @param metadata - The metadata of the relation's property, if there is one.
     * @returns The column, undefined when the property is not a to one relation declaring one.
     */
    private static joinColumnOf(metadata: PropertyMetadata | undefined): string | undefined {
        return isRelationMetadata(metadata) && 'joinColumn' in metadata && typeof metadata.joinColumn === 'string'
            ? metadata.joinColumn
            : undefined;
    }

    /**
     * Reads the rows of an entity with the given ids that the caller may see.
     * @param target - The entity.
     * @param ids - The ids.
     * @param below - The relations to resolve on the rows.
     * @param related - What the rows are narrowed to.
     * @param transaction - The transaction to read through.
     * @param reader - How the rows are read.
     * @returns The rows by their id as text, which is how a foreign key or a set names them.
     */
    private static async readByIds(
        target: Newable<BaseEntity>,
        ids: string[],
        below: RelationTree,
        related: RelatedNarrowing | undefined,
        transaction: Transaction | undefined,
        reader: RelatedRowsReader
    ): Promise<Map<string, BaseEntity>> {
        if (!ids.length) {
            return new Map();
        }
        const narrowed: ScopedWhere<BaseEntity> = RelatedNarrowingUtilities.narrow({ id: { oneOf: ids } }, target, related);
        if (narrowed.matchesNothing || narrowed.where == undefined) {
            return new Map();
        }
        const rows: BaseEntity[] = await reader.findRelated(target, narrowed.where, below, related, transaction);
        return new Map(rows.map(row => [String(row.id), row]));
    }
}