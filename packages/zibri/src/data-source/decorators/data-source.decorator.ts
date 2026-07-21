
import { Injectable, InjectableOptions } from '../../di/decorators/injectable.decorator';

/**
 * Marks a class to be a data source.
 * @param options - Options for the data source.
 */
export function DataSource<T>(options: InjectableOptions<T> = {}): ClassDecorator {
    return target => {
        Injectable(options)(target);
    };
}