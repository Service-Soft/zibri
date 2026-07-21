import { DiContainer } from './di-container';

/**
 * Gets every value that has already been instantiated in the DI container, without constructing
 * anything new.
 * @returns The already-instantiated values.
 */
export function getAllInstantiatedValues(): unknown[] {
    return DiContainer.getInstance().getAllInstantiatedValues();
}