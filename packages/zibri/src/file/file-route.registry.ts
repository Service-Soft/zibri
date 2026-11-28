import { ClassPropertyUtilities } from '../entity/utilities/class-property.utilities';
import { ControllerUtilities } from '../routing/controller.utilities';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ServedFilesMetadata } from './served-files-metadata.model';

/**
 * Which controller serves the files of the rows of each entity, which the url of a `FileReference` points to.
 */
export abstract class FileRouteRegistry {
    /**
     * The controller serving the files of each entity: the first registered with a route serving them.
     */
    private static readonly controllers: Map<Function, Function> = new Map();

    /**
     * The controller a class written in a response finds, through the classes it extends or was copied from.
     */
    private static readonly found: Map<Function, Function | undefined> = new Map();

    /**
     * Forgets every controller, as the controllers of an application starting are registered anew.
     */
    static clear(): void {
        this.controllers.clear();
        this.found.clear();
    }

    /**
     * Registers a controller as the one serving the files of the entities its routes serve files of, unless one was
     * registered before it.
     * @param controllerClass - The controller.
     */
    static register(controllerClass: Newable<unknown>): void {
        for (const route of MetadataUtilities.getControllerRoutes(controllerClass)) {
            const served: ServedFilesMetadata | undefined = MetadataUtilities.getRouteServedFiles(controllerClass, route.controllerMethod);
            if (served != undefined && !this.controllers.has(served.entityClass)) {
                this.controllers.set(served.entityClass, controllerClass);
                this.found.clear();
            }
        }
    }

    /**
     * Finds the url a file of a row is downloaded from.
     * @param classes - The classes the row is written as. The first of them that is served, or extends or was
     * copied from a served entity, names the controller.
     * @param rowId - The id of the row.
     * @param file - The property holding the file, followed by its index for an item of an array, such as
     * `attachments.2`.
     * @returns The url, or undefined when no controller serves the files of the row.
     */
    static findUrl(classes: Function[], rowId: unknown, file: string): string | undefined {
        if (typeof rowId !== 'string' && typeof rowId !== 'number') {
            return undefined;
        }
        for (const cls of classes) {
            const controller: Function | undefined = this.findController(cls);
            if (controller != undefined) {
                return `${ControllerUtilities.resolveUrl(controller)}/${encodeURIComponent(rowId)}/files/${file}`;
            }
        }
        return undefined;
    }

    private static findController(cls: Function): Function | undefined {
        if (this.found.has(cls)) {
            return this.found.get(cls);
        }
        let res: Function | undefined;
        // the class itself and the ones it extends, then the ones its properties were copied from, such as a
        // response class picking some properties of the entity
        for (let inChain: unknown = cls; res == undefined && typeof inChain === 'function'; inChain = Object.getPrototypeOf(inChain)) {
            res = this.controllers.get(inChain);
        }
        for (const source of res == undefined ? ClassPropertyUtilities.resolveCopiedFrom(cls) : []) {
            res ??= this.controllers.get(source);
        }
        this.found.set(cls, res);
        return res;
    }
}