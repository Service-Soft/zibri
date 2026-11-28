import { type BaseEntity } from '../../entity/base-entity.model';
import { type Newable } from '../../types/newable.type';
import { type FrameworkColumn } from './framework-column.model';
import { type MissingFrameworkColumn } from './missing-framework-column.model';

// added on every start that finds them missing, and recorded nowhere: a record of a name the build of 3.0 does not
// carry is one it counts as a newer build's migration, and refuses to start on, which a rolling deploy and a way
// back to 3.0 both need it to do. The columns are nullable, so a build of 3.0 writes its rows without them
// Registered by the file of each entity beside its class, rather than listed here: the entities belong to
// subsystems built on the data layer, which imports none of them. Their files are loaded before any data source
// starts, as every entity a data source is given is. Nothing imported at runtime, so that an entity of a layer
// below the data layer can register without a cycle
/**
 * The columns the framework added to its entities since 3.0, each nullable.
 */
export abstract class FrameworkColumnRegistry {
    private static readonly columns: FrameworkColumn[] = [];

    // by the entity a data source stores, set by the data source as it starts and taken back as it shuts down: an
    // application started after another in the same process, such as in a test, finds only those of its own
    private static readonly missing: Map<Newable<BaseEntity>, MissingFrameworkColumn[]> = new Map();

    /**
     * Registers columns the framework added to one of its entities.
     * @param columns - The columns.
     */
    static register(...columns: FrameworkColumn[]): void {
        this.columns.push(...columns);
    }

    /**
     * Every column registered.
     * @returns The columns.
     */
    static getAll(): readonly FrameworkColumn[] {
        return this.columns;
    }

    /**
     * Whether a value written to a registered column says what a row without the column says, so that a table
     * lacking it stores the row without it.
     * @param entity - The entity.
     * @param property - The property of the column.
     * @param value - The value.
     * @returns True for undefined, null and what `meansAbsent` of the column takes.
     */
    static meansAbsent(entity: Newable<BaseEntity>, property: string, value: unknown): boolean {
        if (value == undefined) {
            return true;
        }
        const registered: FrameworkColumn | undefined = this.findRegistered(entity, property);
        return registered?.meansAbsent?.(value) === true;
    }

    /**
     * Records the columns the tables of a data source lack, for the entities it stores.
     * @param entities - Every entity the data source stores, whose columns recorded before are replaced.
     * @param missing - The columns its tables lack.
     */
    static setMissing(entities: readonly Newable<BaseEntity>[], missing: readonly MissingFrameworkColumn[]): void {
        this.clearMissing(entities);
        for (const column of missing) {
            this.missing.set(column.entity, [...this.missing.get(column.entity) ?? [], column]);
        }
    }

    /**
     * Forgets the columns recorded as missing for the entities of a data source, as it shuts down.
     * @param entities - The entities.
     */
    static clearMissing(entities: readonly Newable<BaseEntity>[]): void {
        for (const entity of entities) {
            this.missing.delete(entity);
        }
    }

    /**
     * Finds the columns of the given properties that the table of an entity lacks.
     * @param entity - The entity, or one an entity of the application extends, such as `ApiKey`.
     * @param properties - The properties.
     * @returns The columns missing, none when the table has them all.
     */
    static findMissing(entity: Newable<BaseEntity>, ...properties: string[]): MissingFrameworkColumn[] {
        return [...this.missing.entries()]
            .filter(([stored]) => stored === entity || stored.prototype instanceof entity)
            .flatMap(([, columns]) => columns.filter(c => properties.includes(c.property)));
    }

    private static findRegistered(entity: Newable<BaseEntity>, property: string): FrameworkColumn | undefined {
        return this.columns.find(c => c.property === property && (c.entity === entity || entity.prototype instanceof c.entity));
    }
}
