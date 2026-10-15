import { JsonOpenApiResponse } from './open-api.model';
import { isNewable, Newable } from '../types/newable.type';

/**
 * The class a json response is written as.
 * @param response - The response.
 * @returns The class, or undefined when the response names none.
 */
export function resolveResponseClass(response: JsonOpenApiResponse): Newable<unknown> | undefined {
    if (response.cls == undefined || isNewable(response.cls)) {
        return response.cls;
    }
    return response.cls();
}