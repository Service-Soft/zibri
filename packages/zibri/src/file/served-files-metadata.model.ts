import { type BaseEntity } from '../entity/base-entity.model';
import { Newable } from '../types/newable.type';

/**
 * What a route serving the files of the rows of an entity declares.
 */
export type ServedFilesMetadata = {
    /**
     * The entity whose files the route serves.
     */
    entityClass: Newable<BaseEntity>,
    /**
     * The route of the same controller whose access rules the route has, the one reading a row.
     */
    accessOf: string,
    /**
     * The classes of the multipart bodies the controller writes the rows with, whose files it stores.
     */
    bodyClasses: Newable<unknown>[]
};