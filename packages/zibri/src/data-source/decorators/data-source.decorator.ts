import { Injectable, InjectableOptions } from '../../di/decorators/injectable.decorator.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';

/**
 * Metadata for a data source.
 */
export type DataSourceMetadata = {
    /**
     * Whether or not this data source is allowed to exist without an application using it.
     *
     * Off by default, because forgetting to list a data source an application does need is a real
     * mistake and a silent one - nothing would connect, and the first query would be where anybody
     * found out.
     *
     * Turn it on for a data source that is *declared* rather than deployed: one a shared module
     * defines for its callers to choose between, or one a factory builds. Defining a class is not
     * the same as intending to run it, and an application that never mentions it should not have to
     * care that it exists.
     */
    allowOrphan: boolean
};

/**
 * The options the \@DataSource decorator accepts.
 */
export type DataSourceMetadataInput<T> = InjectableOptions<T> & Partial<DataSourceMetadata>;

/**
 * Marks a class to be a data source.
 * @param options - Options for the data source.
 */
export function DataSource<T>(options: DataSourceMetadataInput<T> = {}): ClassDecorator {
    const { allowOrphan = false, ...injectableOptions } = options;

    return target => {
        Injectable(injectableOptions)(target);
        MetadataUtilities.setDataSourceMetadata(target, { allowOrphan });
    };
}