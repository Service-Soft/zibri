import type { ZibriApplication } from '../application/application';
import type { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { inject } from '../di/inject.function';
import type { BaseEntity } from '../entity/base-entity.model';
import { MissingEntitiesError } from '../error-handling/errors/missing-entities.error';
import { Newable } from '../types/newable.type';

/**
 * The required entities of every application, so that the one an application is handed finds its own.
 */
const requiredEntitiesByApplication: WeakMap<ZibriApplication, RequiredEntities> = new WeakMap();

/**
 * The entities the parts of one application need a data source to declare, each with what needs it.
 *
 * Gathered while the application initializes and validated once at its end, so a boot is refused once
 * for every entity it lacks. Asked for once it is up, an entity is validated at once.
 */
export class RequiredEntities {
    /**
     * Each entity, with the names of what requires it, in the order they were asked for.
     */
    private readonly requiredBy: Map<Newable<BaseEntity>, string[]> = new Map();

    /**
     * What failed while initializing with an entity missing, which may well be why it failed.
     */
    private readonly failures: unknown[] = [];

    private validated: boolean = false;

    private constructor(private readonly app: ZibriApplication) {}

    /**
     * Gets the required entities of an application.
     * @param app - The application.
     * @returns Its required entities.
     */
    static of(app: ZibriApplication): RequiredEntities {
        const existing: RequiredEntities | undefined = requiredEntitiesByApplication.get(app);
        if (existing != undefined) {
            return existing;
        }
        const created: RequiredEntities = new RequiredEntities(app);
        requiredEntitiesByApplication.set(app, created);
        return created;
    }

    /**
     * Notes entities something requires. Once the application is initialized, validates them at once.
     * @param requiredBy - The name of what requires them.
     * @param entities - The entities.
     * @throws When the application is initialized and a data source declares none of them.
     */
    add(requiredBy: string, entities: Newable<BaseEntity>[]): void {
        if (this.validated) {
            const missing: Newable<BaseEntity>[] = this.findMissing(entities);
            if (missing.length) {
                throw new MissingEntitiesError(new Map(missing.map(e => [e, [requiredBy]])));
            }
            return;
        }
        for (const entity of entities) {
            const names: string[] = this.requiredBy.get(entity) ?? [];
            if (!names.includes(requiredBy)) {
                names.push(requiredBy);
            }
            this.requiredBy.set(entity, names);
        }
    }

    /**
     * Keeps what failed while initializing when an entity is missing, so the parts after it still say
     * what they require.
     * @param error - What failed.
     * @returns Whether it was kept, which it is only while initializing with an entity missing.
     */
    keepFailure(error: unknown): boolean {
        // nothing asked for yet, such as a data source failing to start, is never a missing entity
        if (this.validated || !this.requiredBy.size || !this.findMissing([...this.requiredBy.keys()]).length) {
            return false;
        }
        this.failures.push(error);
        return true;
    }

    /**
     * Validates that a data source declares every entity required so far. Everything asked for after
     * this is validated at once.
     * @throws With every entity no data source declares, and what failed while they were missing as the cause.
     */
    validate(): void {
        this.validated = true;
        const missing: Newable<BaseEntity>[] = this.findMissing([...this.requiredBy.keys()]);
        if (!missing.length) {
            return;
        }
        throw new MissingEntitiesError(
            new Map(missing.map(e => [e, this.requiredBy.get(e) ?? []])),
            this.failures.length ? { cause: new AggregateError(this.failures, 'What failed while the entities were missing') } : undefined
        );
    }

    /**
     * Finds the entities no data source of the application declares.
     * @param entities - The entities.
     * @returns Those no data source declares.
     */
    private findMissing(entities: Newable<BaseEntity>[]): Newable<BaseEntity>[] {
        const declared: Set<Newable<BaseEntity>> = new Set(this.app.options.dataSources.flatMap(dataSourceClass => {
            const dataSource: DataSourceInterface = inject(dataSourceClass);
            return dataSource.entities;
        }));
        return entities.filter(e => !declared.has(e));
    }
}