import { BaseEntity, FileSize, ManyToManyPropertyMetadata, ManyToOnePropertyMetadata, OneToManyPropertyMetadata, OneToOnePropertyMetadata, Relation, RelationMetadata } from '../entity';
import { MimeType } from '../http';

export type ValidationProblem = {
    key: string,
    message: string
};

export class IsRequiredValidationProblem implements ValidationProblem {
    readonly message: string = 'is required';
    constructor(readonly key: string) {}
}

export class TypeMismatchValidationProblem implements ValidationProblem {
    readonly message: string;
    constructor(readonly key: string, type: string) {
        this.message = `should be of type ${type}`;
    }
}

export class MaxFileSizeValidationProblem implements ValidationProblem {
    readonly message: string;
    constructor(readonly key: string, maxSize: FileSize) {
        this.message = `needs to be smaller than ${maxSize}`;
    }
}

export class MimeTypeMismatchValidationProblem implements ValidationProblem {
    readonly message: string;
    constructor(readonly key: string, allowedMimeTypes: MimeType[]) {
        this.message = allowedMimeTypes.length > 1
            ? `the file type needs to be one of: ${allowedMimeTypes.join(', ')}`
            : `the file type needs to be ${allowedMimeTypes[0]}`;
    }
}

export class RelationsNotAllowedValidationProblem implements ValidationProblem {
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
            case Relation.MANY_TO_ONE: {
                return this.getObjectExample(metadata, relationKey);
            }
            case Relation.ONE_TO_MANY: {
                return this.getArrayExample(metadata, relationKey);
            }
            case Relation.ONE_TO_ONE: {
                return this.getObjectExample(metadata, relationKey);
            }
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
        metadata: OneToOnePropertyMetadata<BaseEntity> | ManyToOnePropertyMetadata<BaseEntity>,
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