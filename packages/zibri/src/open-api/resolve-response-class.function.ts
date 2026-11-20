import { isNewable, Newable } from '../types/newable.type';
import { JsonOpenApiResponse } from './open-api.model';

/**
 * The class a json response is written as.
 * @param response - The response.
 * @returns The class, or undefined when the response names none.
 */
export function resolveResponseClass(response: JsonOpenApiResponse): Newable<unknown> | undefined {
    return response.cls == undefined || isNewable(response.cls) ? response.cls : response.cls();
}