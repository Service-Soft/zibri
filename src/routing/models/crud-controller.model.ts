import { Repository } from '../../data-source';
import { inject, repositoryTokenFor } from '../../di';
import { BaseEntity } from '../../entity/base-entity.model';
import { HttpStatus } from '../../http';
import { PaginationResult, Response } from '../../open-api';
import { DeepPartial, Newable } from '../../types';
import { Body, Delete, Get, Param, Patch, Post } from '../decorators';

/**
 * Interface for a CRUD (create, read, update, delete) controller.
 */
export interface CrudControllerInterface<
    T extends BaseEntity,
    CreateData extends DeepPartial<T> = DeepPartial<T>,
    UpdateData extends DeepPartial<T> = DeepPartial<T>
> {
    /**
     * Creates a new entity with the given data.
     */
    create: (data: CreateData) => Promise<T>,
    /**
     * Gets paginated data from the given page.
     */
    findAll: (page: number, limit: number) => Promise<PaginationResult<T>>,
    /**
     * Finds an entity with the given id.
     */
    findById: (id: T['id']) => Promise<T>,
    /**
     * Updates the entity with the given id by the given data.
     */
    updateById: (id: T['id'], data: UpdateData) => Promise<T>,
    /**
     * Deletes the entity with the given id.
     */
    deleteById: (id: T['id']) => Promise<void>
}

// eslint-disable-next-line jsdoc/require-param, jsdoc/require-returns
/**
 * Defines a CRUD controller for the specified entity.
 */
export function CrudController<
    T extends BaseEntity,
    CreateData extends DeepPartial<T> = DeepPartial<T>,
    UpdateData extends DeepPartial<T> = DeepPartial<T>
>(
    entityClass: Newable<T>,
    createDataClass: Newable<CreateData>,
    updateDataClass: Newable<UpdateData>
): Newable<CrudControllerInterface<T, CreateData, UpdateData>> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    class Temp implements CrudControllerInterface<T, CreateData, UpdateData> {
        // eslint-disable-next-line jsdoc/require-jsdoc
        protected repo: Repository<T, CreateData, UpdateData>;

        constructor() {
            this.repo = inject(repositoryTokenFor(entityClass));
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.object(entityClass)
        @Post()
        async create(
            @Body(createDataClass)
            data: CreateData
        ): Promise<T> {
            return await this.repo.create(data);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.paginated(entityClass)
        @Get()
        async findAll(
            @Param.query('page', { type: 'number' })
            page: number,
            @Param.query('limit', { type: 'number' })
            limit: number
        ): Promise<PaginationResult<T>> {
            return await this.repo.findAllPaginated(page, limit);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.error(HttpStatus.NOT_FOUND)
        @Response.object(entityClass)
        @Get('/:id')
        async findById(
            @Param.path('id', { type: 'string', format: 'uuid' })
            id: T['id']
        ): Promise<T> {
            return await this.repo.findById(id);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.error(HttpStatus.NOT_FOUND)
        @Response.object(entityClass)
        @Patch('/:id')
        async updateById(
            @Param.path('id', { type: 'string', format: 'uuid' })
            id: T['id'],
            @Body(updateDataClass)
            data: UpdateData
        ): Promise<T> {
            return await this.repo.updateById(id, data);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.error(HttpStatus.NOT_FOUND)
        @Response.empty()
        @Delete('/:id')
        async deleteById(
            @Param.path('id', { type: 'string', format: 'uuid' })
            id: T['id']
        ): Promise<void> {
            await this.repo.deleteById(id);
        }
    }
    return Temp;
}