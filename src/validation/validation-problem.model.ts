import { BaseEntity } from '../entity/base-entity.model';
import { RelationMetadata } from '../entity/decorators/property.decorator';
import { BelongsToOnePropertyMetadata } from '../entity/models/belongs-to-one-property-metadata.model';
import { FileSize } from '../entity/models/file-property-metadata.model';
import { HasOnePropertyMetadata } from '../entity/models/has-one-property-metadata.model';
import { ManyToManyPropertyMetadata } from '../entity/models/many-to-many-property-metadata.model';
import { ManyToOnePropertyMetadata } from '../entity/models/many-to-one-property-metadata.model';
import { OneToManyPropertyMetadata } from '../entity/models/one-to-many-property-metadata.model';
import { Relation } from '../entity/models/relation.enum';
import { MimeType } from '../http/mime-type.enum';

/**
 * A validation problem, consisting of the key where the problem is located and a description of the problem.
 */
export type ValidationProblem = {
    /**
     * The key where the problem is located.
     */
    key: string,
    /**
     * The validation problem message.
     */
    message: string
};

/**
 * The validation problem that the property is required and no value has been provided.
 */
export class IsRequiredValidationProblem implements ValidationProblem {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly message: string = 'is required';
    constructor(readonly key: string) {}
}

/**
 * The validation problem that the provided value has an incorrect type.
 */
export class TypeMismatchValidationProblem implements ValidationProblem {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly message: string;
    constructor(readonly key: string, type: string) {
        this.message = `should be of type ${type}`;
    }
}

/**
 * The validation problem that the provided file is too big.
 */
export class MaxFileSizeValidationProblem implements ValidationProblem {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly message: string;
    constructor(readonly key: string, maxSize: FileSize) {
        this.message = `needs to be smaller than ${maxSize}`;
    }
}

/**
 * The validation problem that the provided file has an incorrect mime type.
 */
export class MimeTypeMismatchValidationProblem implements ValidationProblem {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly message: string;
    constructor(readonly key: string, allowedMimeTypes: MimeType[]) {
        this.message = allowedMimeTypes.length > 1
            ? `the file type needs to be one of: ${allowedMimeTypes.join(', ')}`
            : `the file type needs to be ${allowedMimeTypes[0]}`;
    }
}

/**
 * The validation problem that the provided value has relation data on it, which is not supported.
 */
export class RelationsNotAllowedValidationProblem implements ValidationProblem {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly message: string;
    constructor(readonly key: string, metadata: RelationMetadata<BaseEntity>, relationKey: string) {
        this.message = [
            'relations are not allowed as part of create or update data.',
            'If you don\'t want to omit the relation, you probably want to do something like:',
            this.getExample(metadata, relationKey)
        ].join('\n');
    }

    private getExample(metadata: RelationMetadata<BaseEntity>, relationKey: string): string {
        switch (metadata.type) {
            case Relation.MANY_TO_ONE:
            case Relation.HAS_ONE:
            case Relation.BELONGS_TO_ONE: {
                return this.getObjectExample(metadata, relationKey);
            }
            case Relation.ONE_TO_MANY:
            case Relation.MANY_TO_MANY: {
                return this.getArrayExample(metadata, relationKey);
            }
        }
    }

    private getArrayExample(
        metadata: ManyToManyPropertyMetadata<BaseEntity> | OneToManyPropertyMetadata<BaseEntity>,
        relationKey: string
    ): string {
        return [
            `class MyEntityCreateDto extends OmitType<MyEntity, '${relationKey}'> {`,
            `    @Property.array({ items: { type: 'object', cls: ${metadata.target.name}CreateDto} })`,
            `    ${relationKey}: ${metadata.target.name}CreateDto[]`,
            '}'
        ].join('\n');
    }

    private getObjectExample(
        metadata: BelongsToOnePropertyMetadata<BaseEntity> | HasOnePropertyMetadata<BaseEntity> | ManyToOnePropertyMetadata<BaseEntity>,
        relationKey: string
    ): string {
        return [
            `class MyEntityCreateDto extends OmitType<MyEntity, '${relationKey}'> {`,
            `    @Property.object({ cls: ${metadata.target.name}CreateDto })`,
            `    ${relationKey}: ${metadata.target.name}CreateDto`,
            '}'
        ].join('\n');
    }
}