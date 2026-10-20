import { ArrayPropertyMetadataInput } from '../../entity/models/array-property-metadata.model.ts';
import { BooleanPropertyMetadataInput } from '../../entity/models/boolean-property-metadata.model.ts';
import { DatePropertyMetadataInput } from '../../entity/models/date-property-metadata.model.ts';
import { NumberPropertyMetadataInput } from '../../entity/models/number-property-metadata.model.ts';
import { ObjectPropertyMetadataInput } from '../../entity/models/object-property-metadata.model.ts';
import { OneOfPropertyMetadataInput } from '../../entity/models/one-of-property-metadata.model.ts';
import { StringPropertyMetadataInput } from '../../entity/models/string-property-metadata.model.ts';
import { UnknownPropertyMetadataInput } from '../../entity/models/unknown-property-metadata.model.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';

/**
 * How a migration says a property is stored: the same metadata the property decorator takes, and the
 * type that decorator stands for.
 *
 * Written out in the migration rather than read off the entity, because a migration keeps running
 * long after the entity has changed again - on every new database, in every later version.
 *
 * What the decorator says about indexes, uniques and searching is left out: the data source keeps
 * those as the entity declares them now, once the migrations have run.
 */
export type MigrationPropertyMetadata
    = | OmitStrict<StringPropertyMetadataInput, 'unique' | 'index' | 'fuzzySearchable'> & {
        /**
         * The type of the property.
         */
        type: 'string'
    }
    | OmitStrict<NumberPropertyMetadataInput, 'unique' | 'index'> & {
        /**
         * The type of the property.
         */
        type: 'number'
    }
    | OmitStrict<BooleanPropertyMetadataInput, 'index'> & {
        /**
         * The type of the property.
         */
        type: 'boolean'
    }
    | OmitStrict<DatePropertyMetadataInput, 'index'> & {
        /**
         * The type of the property.
         */
        type: 'date'
    }
    | ObjectPropertyMetadataInput & {
        /**
         * The type of the property.
         */
        type: 'object'
    }
    | ArrayPropertyMetadataInput & {
        /**
         * The type of the property.
         */
        type: 'array'
    }
    | UnknownPropertyMetadataInput & {
        /**
         * The type of the property.
         */
        type: 'unknown'
    }
    | OneOfPropertyMetadataInput & {
        /**
         * The type of the property.
         */
        type: 'oneOf'
    };