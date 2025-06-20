import { BaseEntity, Property, PropertyMetadata, RelationMetadata } from '../entity';
import { ValidationError } from '../error-handling';
import { MimeType } from '../http';
import { FormData } from '../parsing';
import { BodyMetadata, HeaderParamMetadata, PathParamMetadata, QueryParamMetadata } from '../routing';
import { ExcludeStrict, Newable, OmitStrict } from '../types';
import { MetadataUtilities } from '../utilities';
import { validateBoolean, validateDate, validateFile, validateNumber, validateString } from './functions';
import { IsRequiredValidationProblem, RelationsNotAllowedValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from './validation-problem.model';
import { ValidationServiceInterface } from './validation-service.interface';

type PathParamValidationFunction = (param: unknown, meta: PathParamMetadata, parentKey: string | undefined) => ValidationProblem[];

type QueryParamValidationFunction = (param: unknown, meta: QueryParamMetadata, parentKey: string | undefined) => ValidationProblem[];

type HeaderParamValidationFunction = (param: unknown, meta: HeaderParamMetadata, parentKey: string | undefined) => ValidationProblem[];

type PropertyValidationFunction = (
    key: string,
    property: unknown,
    metadata: PropertyMetadata,
    parentKey: string | undefined
) => ValidationProblem[];

export class ValidationService implements ValidationServiceInterface {

    private readonly pathParamValidationFunctions: Record<PathParamMetadata['type'], PathParamValidationFunction> = {
        string: (param, meta, parentKey) => validateString(meta.name, param, meta, parentKey),
        number: (param, meta, parentKey) => validateNumber(meta.name, param, meta, parentKey),
        boolean: (param, meta, parentKey) => validateBoolean(meta.name, param, meta, parentKey),
        date: (param, meta, parentKey) => validateDate(meta.name, param, meta, parentKey)
    };

    private readonly queryParamValidationFunctions: Record<QueryParamMetadata['type'], QueryParamValidationFunction> = {
        string: (param, meta, parentKey) => validateString(meta.name, param, meta, parentKey),
        number: (param, meta, parentKey) => validateNumber(meta.name, param, meta, parentKey),
        boolean: (param, meta, parentKey) => validateBoolean(meta.name, param, meta, parentKey),
        date: (param, meta, parentKey) => validateDate(meta.name, param, meta, parentKey),
        object: (param, meta, parentKey) => this.validateObjectProperty(meta.name, param, meta, parentKey),
        array: (param, meta, parentKey) => this.validateArrayProperty(meta.name, param, meta, parentKey)
    };

    private readonly headerParamValidationFunctions: Record<HeaderParamMetadata['type'], HeaderParamValidationFunction> = {
        string: (param, meta, parentKey) => validateString(meta.name, param, meta, parentKey),
        number: (param, meta, parentKey) => validateNumber(meta.name, param, meta, parentKey),
        boolean: (param, meta, parentKey) => validateBoolean(meta.name, param, meta, parentKey),
        date: (param, meta, parentKey) => validateDate(meta.name, param, meta, parentKey),
        object: (param, meta, parentKey) => this.validateObjectProperty(meta.name, param, meta, parentKey),
        array: (param, meta, parentKey) => this.validateArrayProperty(meta.name, param, meta, parentKey)
    };

    // eslint-disable-next-line stylistic/max-len
    private readonly propertyValidationFunctions: Record<ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity>>['type'], PropertyValidationFunction> = {
        object: this.validateObjectProperty.bind(this),
        array: this.validateArrayProperty.bind(this),
        number: validateNumber,
        string: validateString,
        date: validateDate,
        boolean: validateBoolean,
        file: validateFile
    };

    validateHeaderParam(param: unknown, meta: HeaderParamMetadata): void {
        const validate: HeaderParamValidationFunction | undefined = this.headerParamValidationFunctions[meta.type];
        if (validate == undefined) {
            throw new Error(`Unknown type for header parameter "${meta.name}": ${meta.type}`);
        }
        const res: ValidationProblem[] = validate(param, meta, undefined);
        if (res.length) {
            throw new ValidationError('header', res);
        }
    }

    validatePathParam(param: unknown, meta: PathParamMetadata): void {
        const validate: PathParamValidationFunction | undefined = this.pathParamValidationFunctions[meta.type];
        if (validate == undefined) {
            throw new Error(`Unknown type for path parameter "${meta.name}": ${meta.type}`);
        }
        const res: ValidationProblem[] = validate(param, meta, undefined);
        if (res.length) {
            throw new ValidationError('path', res);
        }
    }

    validateQueryParam(param: unknown, meta: QueryParamMetadata): void {
        const validate: QueryParamValidationFunction | undefined = this.queryParamValidationFunctions[meta.type];
        if (validate == undefined) {
            throw new Error(`Unknown type for query parameter "${meta.name}": ${meta.type}`);
        }
        const res: ValidationProblem[] = validate(param, meta, undefined);
        if (res.length) {
            throw new ValidationError('query', res);
        }
    }

    validateRequestBody(body: unknown, meta: BodyMetadata): void {
        class Temp implements OmitStrict<FormData<typeof meta.modelClass>, 'cleanup'> {
            @Property.object({ cls: () => meta.modelClass, description: 'the actual data from the request body' })
            value!: typeof meta.modelClass;

            @Property.string({ description: 'the path to the temporary folder where uploaded files are cached' })
            tempFolder!: string;
        }

        const cls: Newable<unknown> = meta.type === MimeType.FORM_DATA ? Temp : meta.modelClass;
        const res: ValidationProblem[] = this.validateModel(body, cls, undefined);
        if (res.length) {
            throw new ValidationError('body', res);
        }
    }

    private validateModel(body: unknown, cls: Newable<unknown>, parentKey: string | undefined): ValidationProblem[] {
        const modelProperties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);

        const keysOfBody: string[] = Object.keys(body as Record<string, unknown>);
        const keysOfModel: string[] = Object.keys(modelProperties);
        const unknownKeys: string[] = keysOfBody.filter(k => !keysOfModel.includes(k));
        const res: ValidationProblem[] = [];
        for (const key of unknownKeys) {
            const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
            res.push({ key: fullKey, message: 'this key is unknown' });
        }
        for (const [propertyKey, metadata] of Object.entries(modelProperties)) {
            const property: unknown = (body as Record<string, unknown>)[propertyKey];
            const errors: ValidationProblem[] = this.validateProperty(propertyKey, property, metadata, parentKey);
            res.push(...errors);
        }
        return res;
    }

    private validateProperty(
        key: string,
        property: unknown,
        metadata: PropertyMetadata,
        parentKey: string | undefined
    ): ValidationProblem[] {
        const fullKey: string = parentKey ? `${parentKey}.${key}` : key;

        if (
            metadata.type === 'many-to-one'
            || metadata.type === 'one-to-many'
            || metadata.type === 'one-to-one'
            || metadata.type === 'many-to-many'
        ) {
            return [new RelationsNotAllowedValidationProblem(fullKey, metadata, key)];
        }

        const validate: PropertyValidationFunction | undefined = this.propertyValidationFunctions[metadata.type];
        if (validate == undefined) {
            throw new Error(`Unknown type for property "${fullKey}": ${metadata.type}`);
        }
        const res: ValidationProblem[] = validate(key, property, metadata, parentKey);
        return res;
    }

    private validateArrayProperty(
        key: string,
        property: unknown,
        metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
        parentKey: string | undefined
    ): ValidationProblem[] {
        if (metadata.type !== 'array') {
            throw new Error('Tried to do array based validation on a non array value.');
        }
        const fullKey: string = parentKey ? `${parentKey}.${key}` : key;

        if (property == undefined && metadata.required) {
            return [new IsRequiredValidationProblem(fullKey)];
        }
        if (property == undefined && !metadata.required) {
            return [];
        }
        if (!Array.isArray(property)) {
            return [new TypeMismatchValidationProblem(fullKey, 'array')];
        }

        const res: ValidationProblem[] = [];
        for (let i: number = 0; i < property.length; i++) {
            const item: unknown = property[i];
            const errors: ValidationProblem[] = this.validateProperty(String(i), item, metadata.items, key);
            res.push(...errors);
        }
        return res;
    }

    private validateObjectProperty(
        key: string,
        property: unknown,
        metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
        parentKey: string | undefined
    ): ValidationProblem[] {
        if (metadata.type !== 'object') {
            throw new Error('Tried to do object based validation on a non object value.');
        }
        const fullKey: string = parentKey ? `${parentKey}.${key}` : key;

        if (property == undefined && metadata.required) {
            return [new IsRequiredValidationProblem(fullKey)];
        }
        if (property == undefined && !metadata.required) {
            return [];
        }
        if (typeof property !== 'object') {
            return [new TypeMismatchValidationProblem(fullKey, 'object')];
        }

        const objectProperties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(metadata.cls());
        const keysOfBody: string[] = Object.keys(property as Record<string, unknown>);
        const keysOfModel: string[] = Object.keys(objectProperties);
        const unknownKeys: string[] = keysOfBody.filter(k => !keysOfModel.includes(k));

        const res: ValidationProblem[] = [];
        for (const key of unknownKeys) {
            res.push({ key, message: 'this key is unknown' });
        }
        if (res.length) {
            throw new ValidationError('body', res);
        }

        for (const [propertyKey, m] of Object.entries(objectProperties)) {
            const childProperty: unknown = (property as Record<string, unknown>)[propertyKey];
            const errors: ValidationProblem[] = this.validateProperty(propertyKey, childProperty, m, key);
            res.push(...errors);
        }
        return res;
    }
}