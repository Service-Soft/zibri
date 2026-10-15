import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { SoftDeleteEntity } from './models/soft-delete-entity.model';
import { SoftDeleteRepository } from './soft-delete-repository';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { NotFoundError } from '../error-handling/errors/not-found.error';
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
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, defaultRelations: { steps: true } })
class Recipe extends SoftDeleteEntity {
    /**
     * What it is called.
     */
    @Property.string()
    name!: string;

    /**
     * The rows that have to be resolved whether or not anybody asked for them. Not removed along
     * with the recipe, so that a step - which cannot be soft deleted - is a row of its own.
     */
    @Property.oneToMany({ target: () => Step, inverseSide: 'recipe', cascade: ['insert', 'update'] })
    steps!: Step[];
}

/**
 * The far side of the relation a recipe always reads.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
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
    let recipes: SoftDeleteRepository<Recipe>;

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

    it('hands back what an update that marks the row deleted wrote', async () => {
        const recipe: Recipe = await recipes.create({ name: 'stew', steps: [{ instruction: 'stir' }] });

        // the relation is read after the write, through the same guard that now hides the row
        const updated: Recipe = await recipes.updateById(recipe.id, { name: 'old stew', deleted: true });

        expect(updated).toMatchObject({ name: 'old stew', deleted: true });
        expect(updated.steps.map(s => s.instruction)).toEqual(['stir']);
        expect(await recipes.findById(recipe.id, { deleted: 'include' })).toMatchObject({ name: 'old stew', deleted: true });
    });

    it('hands back what it wrote without a change set as well', async () => {
        const recipe: Recipe = await recipes.create({ name: 'salad', steps: [{ instruction: 'toss' }] });

        const updated: Recipe = await recipes.updateByIdWithoutChangeSet(recipe.id, { deleted: true });

        expect(updated.deleted).toBe(true);
        expect(updated.steps.map(s => s.instruction)).toEqual(['toss']);
    });

    it('refuses to mark a row deleted that already is, and writes nothing', async () => {
        const recipe: Recipe = await recipes.create({ name: 'cake', steps: [] });
        await recipes.deleteById(recipe.id);

        await expect(recipes.updateById(recipe.id, { name: 'pie', deleted: true })).rejects.toThrow(NotFoundError);
        expect((await recipes.findById(recipe.id, { deleted: 'include' })).name).toBe('cake');
    });
});