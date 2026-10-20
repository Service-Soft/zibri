import { MigrationPropertyMetadata } from './migration-property-metadata.model.ts';

/**
 * The types a property of the given type can become through {@link ValueConversion.CAST}: its own
 * type, and a number and a string into each other.
 */
export type CastablePropertyType<From extends MigrationPropertyMetadata['type']> = From extends 'number' | 'string'
    ? 'number' | 'string'
    : From;