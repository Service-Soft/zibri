import { type FrameworkColumn } from './framework-column.model';

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
}