import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, StartedTestServer, startTestServer } from 'zibri-testing';

import { SoftDeleteEntity } from './models/soft-delete-entity.model';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { Newable } from '../types/newable.type';

/**
 * A soft delete hands its rows back with the relations they read, the same as any other write.
 *
 * Its own case, and container free, because a soft delete is the one bulk write whose rows cannot be
 * found again afterwards: it is an update that marks them deleted, and every read of the repository
 * that wrote them is narrowed to the rows that are not.
 */

/**
 * Deleted by marking rather than removing, and always read with the rows beside it.
 */
@Entity({ allowOrphan: true, allowDuplicate: true, defaultRelations: { steps: true } })
class Recipe extends SoftDeleteEntity {
    /**
     * What it is called.
     */
    @Property.string()
    name!: string;

    /**
     * The rows that have to be resolved whether or not anybody asked for them.
     */
    @Property.oneToMany({ target: () => Step, inverseSide: 'recipe' })
    steps!: Step[];
}

/**
 * The far side of the relation a recipe always reads.
 */
@Entity({ allowOrphan: true, allowDuplicate: true })
class Step extends BaseEntity {
    /**
     * What to do.
     */
    @Property.string()
    instruction!: string;

    /**
     * The recipe it belongs to.
     */
    @Property.manyToOne({ target: () => Recipe, joinColumn: 'recipeId', inverseSide: 'steps', required: false })
    recipe?: Recipe;

    /**
     * The key that relation is stored as.
     */
    @Property.string({ format: 'uuid', required: false })
    recipeId?: string;
}

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, Recipe, Step]
});

describe('what a soft delete hands back', () => {
    let server: StartedTestServer | undefined;
    let recipes: Repository<Recipe>;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        recipes = inject(repositoryTokenFor(Recipe));
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('resolves the relation the entity always reads', async () => {
        const recipe: Recipe = await recipes.create({ name: 'bread', steps: [{ instruction: 'knead' }] });

        const deleted: Recipe[] = await recipes.deleteAll({ id: recipe.id }, { returnDeleted: true });

        // the rows are marked deleted rather than removed, so asking for them again through this
        // repository answers with nothing - which is why what comes back has to be resolved from the
        // rows the write already holds rather than found a second time
        expect(deleted.map(d => d.name)).toEqual(['bread']);
        expect(deleted.map(d => d.steps.map(s => s.instruction))).toEqual([['knead']]);
    });

    it('counts what it marked when nobody asked for the rows', async () => {
        const recipe: Recipe = await recipes.create({ name: 'soup', steps: [{ instruction: 'simmer' }] });

        const count: number = await recipes.deleteAll({ id: recipe.id });

        expect(count).toBe(1);
        expect(await recipes.count({ where: { id: recipe.id } })).toBe(0);
    });
});