import { FilterConfig, OrderValue } from 'zibri-contract';

import { PaginationResult } from '../../data-source/models/pagination-result.model';
import { Where } from '../../data-source/models/where/where-filter.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { EntityOrder } from '../../entity/models/entity-order.model';
import { FilePropertyUtilities, StoredFileProperty } from '../../file/file-property.utilities';
import { HttpStatus } from '../../http/http-status.enum';
import { MimeType } from '../../http/mime-type.enum';
import { Response } from '../../open-api/decorators/response.decorator';
import { FileResponse } from '../../parsing/form-data/file-response.model';
import { FormData } from '../../parsing/form-data/form-data.model';
import { DeepPartial } from '../../types/deep-partial.type';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { BodyMetadataInput, StreamBodyMetadataInput } from '../decorators/body-metadata.model';
import { Body } from '../decorators/body.decorator';
import { Delete } from '../decorators/delete.decorator';
import { Get } from '../decorators/get.decorator';
import { Param } from '../decorators/param.decorator';
import { Patch } from '../decorators/patch.decorator';
import { Post } from '../decorators/post.decorator';
import { FilterUtilities } from '../filter/filter.utilities';
import { CrudControllerFileUtilities } from './crud-controller-file.utilities';
import { CrudControllerOptions } from './crud-controller-options.model';
import { CrudControllerOrderUtilities } from './crud-controller-order.utilities';

/**
 * The largest page a CRUD controller reads, when it was given no `maxLimit`.
 */
const DEFAULT_MAX_LIMIT: number = 100;

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
     * Gets paginated data from the given page, filtered and ordered as given.
     */
    findAll: (page: number, limit: number, filter?: object, order?: OrderValue<T>) => Promise<PaginationResult<T>>,
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
    deleteById: (id: T['id']) => Promise<void>,
    /**
     * Downloads a file of the entity with the given id kept in a file store: the property, followed by the index for
     * an item of an array, such as `attachments.2`. A route only of an entity with such files.
     */
    findFile?: (id: T['id'], file: string) => Promise<FileResponse>
}

// TODO 4.0: CrudController(entityClass, options?), the classes of the bodies among the options as
// `createData?` and `updateData?`, each the entity's DeepPartial without one, and what findAll takes
// (maxLimit, filter, order) grouped as `query?`
// eslint-disable-next-line jsdoc/require-param, jsdoc/require-returns
/**
 * Defines a CRUD controller for the specified entity. Its `findAll` takes a `filter` when the options configure one,
 * and an `order` unless they turn it off.
 */
export function CrudController<
    T extends BaseEntity,
    CreateData extends DeepPartial<T> = DeepPartial<T>,
    UpdateData extends DeepPartial<T> = DeepPartial<T>
>(
    entityClass: Newable<T>,
    createDataClass: Newable<CreateData>,
    updateDataClass: Newable<UpdateData>,
    // the entity is the class handed over alone: options typed without it, as 3.0 had no parameter, would
    // otherwise have the entity inferred as BaseEntity
    options: CrudControllerOptions<NoInfer<T>> = {}
): Newable<CrudControllerInterface<T, CreateData, UpdateData>> {
    // the page size comes from whoever sends the request, so it is bounded here: the repository takes
    // a limit named in code as meant, however large
    const maxLimit: number = options.maxLimit ?? DEFAULT_MAX_LIMIT;
    const filterConfig: FilterConfig<T> | undefined = options.filter;
    // resolved once, so a config that can't filter the entity stops the start
    const filterClass: Newable<object> | undefined = filterConfig == undefined
        ? undefined
        : FilterUtilities.resolveFilterClass(filterConfig, entityClass);
    const orderClass: Newable<object> | undefined = options.order === false
        ? undefined
        : CrudControllerOrderUtilities.resolveOrderClass(entityClass, options.order);
    // an entity keeping files in a file store is written with multipart bodies, which carry the files, and serves
    // them at a route of their own
    const fileProperties: StoredFileProperty[] = FilePropertyUtilities.resolveStoredFileProperties(entityClass);
    const bodyOptions: ExcludeStrict<BodyMetadataInput, StreamBodyMetadataInput> = fileProperties.length
        ? { type: MimeType.FORM_DATA }
        : {};
    // eslint-disable-next-line jsdoc/require-jsdoc
    class Temp implements CrudControllerInterface<T, CreateData, UpdateData> {
        // a getter, as a class built from this one with OmitClass, PickClass or IntersectionClass runs
        // none of its constructor. A subclass declaring `repo` as a field of its own shadows it
        // eslint-disable-next-line jsdoc/require-jsdoc
        protected get repo(): Repository<T, CreateData, UpdateData> {
            return inject(repositoryTokenFor(entityClass));
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.object(entityClass)
        @Post()
        async create(
            @Body(createDataClass, bodyOptions)
            data: CreateData | FormData<CreateData>
        ): Promise<T> {
            return data instanceof FormData
                ? await CrudControllerFileUtilities.create(this.repo, fileProperties, data)
                : await this.repo.create(data);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.paginated(entityClass)
        @Get()
        async findAll(
            @Param.query('page', { type: 'number', format: 'integer', min: 1 })
            page: number,
            @Param.query('limit', { type: 'number', format: 'integer', min: 1, max: maxLimit })
            limit: number,
            // declared below, only when the options let a list be filtered or ordered. A rest parameter, which the
            // check that every parameter of a route is declared doesn't count, as only the declared ones are passed.
            ...[filter, order]: [filter?: object, order?: OrderValue<T>]
        ): Promise<PaginationResult<T>> {
            const where: Where<T> | undefined = filter == undefined || filterConfig == undefined
                ? undefined
                : FilterUtilities.resolveWhere(filterConfig, entityClass, filter);
            // the order class only takes properties of the entity it was resolved from, nested the way the repository
            // nests an order
            const entityOrder: EntityOrder<T> | undefined = order as EntityOrder<T> | undefined;
            return await this.repo.findAllPaginated(page, limit, { where, order: entityOrder });
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
            @Body(updateDataClass, bodyOptions)
            data: UpdateData | FormData<UpdateData>
        ): Promise<T> {
            return data instanceof FormData
                ? await CrudControllerFileUtilities.updateById(this.repo, id, fileProperties, data)
                : await this.repo.updateById(id, data);
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

        // a route only of an entity keeping files in a file store, see below
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.error(HttpStatus.NOT_FOUND)
        @Response.file()
        async findFile(
            @Param.path('id', { type: 'string', format: 'uuid' })
            id: T['id'],
            @Param.path('file', { type: 'string' })
            file: string
        ): Promise<FileResponse> {
            // read through findById, so that a row the caller may not read is not found
            return await CrudControllerFileUtilities.resolveDownload(await this.findById(id), fileProperties, file);
        }
    }
    if (fileProperties.length) {
        const descriptor: PropertyDescriptor = Object.getOwnPropertyDescriptor(Temp.prototype, 'findFile') ?? {};
        Get('/:id/files/:file')(Temp.prototype, 'findFile', descriptor);
        // with the access rules of findById, and as the route the url of each file of a response points to. The bodies
        // are checked at start for a file they would hand to a column holding bytes
        MetadataUtilities.setRouteServedFiles(
            Temp,
            { entityClass, accessOf: 'findById', bodyClasses: [createDataClass, updateDataClass] },
            'findFile'
        );
    }
    // a parameter decorator can't be left out inside a class body, so these are applied the way the class body
    // would, after it: a list that can't be filtered or ordered doesn't name the parameter, also in its OpenAPI.
    if (filterClass != undefined) {
        Param.query('filter', { type: 'object', cls: () => filterClass, required: false })(Temp.prototype, 'findAll', 2);
    }
    if (orderClass != undefined) {
        Param.query('order', { type: 'object', cls: () => orderClass, required: false })(Temp.prototype, 'findAll', 3);
    }
    return Temp;
}