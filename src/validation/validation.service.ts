
import { Property, PropertyMetadata, RelationMetadata } from '../entity';
import { BaseEntity } from '../entity/base-entity.model';
import { ValidationError } from '../error-handling';
import { MimeType } from '../http';
import { FormData } from '../parsing';
import { BodyMetadata, HeaderParamMetadata, PathParamMetadata, QueryParamMetadata } from '../routing';
import { ExcludeStrict, Newable, OmitStrict } from '../types';
import { MetadataUtilities, ObjectUtilities, type Path } from '../utilities';
import { WebsocketRequest } from '../websocket';
import { validateBoolean, validateDate, validateFile, validateNumber, validateString } from './functions';
import { IsRequiredValidationProblem, RelationsNotAllowedValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from './validation-problem.model';
import { ValidationServiceInterface } from './validation-service.interface';

/**
 * Function for validating a path parameter.
 */
type PathParamValidationFunction = (
    param: unknown,
    meta: PathParamMetadata,
    parentKey: string | undefined,
    entity: unknown | undefined
) => ValidationProblem[];

/**
 * Function for validating a query parameter.
 */
type QueryParamValidationFunction = (
    param: unknown,
    meta: QueryParamMetadata,
    parentKey: string | undefined,
    entity: unknown | undefined
) => ValidationProblem[];

/**
 * Function for validating a header parameter.
 */
type HeaderParamValidationFunction = (
    param: unknown,
    meta: HeaderParamMetadata,
    parentKey: string | undefined,
    entity: unknown | undefined
) => ValidationProblem[];

/**
 * Function for validating a single property.
 */
type PropertyValidationFunction = (
    key: string,
    property: unknown,
    metadata: PropertyMetadata,
    parentKey: string | undefined,
    entity: unknown | undefined
) => ValidationProblem[];

/**
 * The default validation service implementation of Zibri.
 */
export class ValidationService implements ValidationServiceInterface {

    private readonly pathParamValidationFunctions: Record<PathParamMetadata['type'], PathParamValidationFunction> = {
        string: (param, meta, parentKey, entity) => validateString(meta.name, param, meta, parentKey, entity),
        number: (param, meta, parentKey, entity) => validateNumber(meta.name, param, meta, parentKey, entity),
        boolean: (param, meta, parentKey, entity) => validateBoolean(meta.name, param, meta, parentKey, entity),
        date: (param, meta, parentKey, entity) => validateDate(meta.name, param, meta, parentKey, entity)
    };

    private readonly queryParamValidationFunctions: Record<QueryParamMetadata['type'], QueryParamValidationFunction> = {
        string: (param, meta, parentKey, entity) => validateString(meta.name, param, meta, parentKey, entity),
        number: (param, meta, parentKey, entity) => validateNumber(meta.name, param, meta, parentKey, entity),
        boolean: (param, meta, parentKey, entity) => validateBoolean(meta.name, param, meta, parentKey, entity),
        date: (param, meta, parentKey, entity) => validateDate(meta.name, param, meta, parentKey, entity),
        object: (param, meta, parentKey, entity) => this.validateObjectProperty(meta.name, param, meta, parentKey, entity),
        array: (param, meta, parentKey, entity) => this.validateArrayProperty(meta.name, param, meta, parentKey, entity)
    };

    private readonly headerParamValidationFunctions: Record<HeaderParamMetadata['type'], HeaderParamValidationFunction> = {
        string: (param, meta, parentKey, entity) => validateString(meta.name, param, meta, parentKey, entity),
        number: (param, meta, parentKey, entity) => validateNumber(meta.name, param, meta, parentKey, entity),
        boolean: (param, meta, parentKey, entity) => validateBoolean(meta.name, param, meta, parentKey, entity),
        date: (param, meta, parentKey, entity) => validateDate(meta.name, param, meta, parentKey, entity),
        object: (param, meta, parentKey, entity) => this.validateObjectProperty(meta.name, param, meta, parentKey, entity),
        array: (param, meta, parentKey, entity) => this.validateArrayProperty(meta.name, param, meta, parentKey, entity)
    };

    // eslint-disable-next-line stylistic/max-len
    private readonly propertyValidationFunctions: Record<ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity>>['type'], PropertyValidationFunction> = {
        object: this.validateObjectProperty.bind(this),
        array: this.validateArrayProperty.bind(this),
        number: validateNumber,
        string: validateString,
        date: validateDate,
        boolean: validateBoolean,
        file: validateFile,
        unknown: () => []
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateHeaderParam(param: unknown, meta: HeaderParamMetadata): void {
        const validate: HeaderParamValidationFunction | undefined = this.headerParamValidationFunctions[meta.type];
        if (validate == undefined) {
            throw new Error(`Unknown type for header parameter "${meta.name}": ${meta.type}`);
        }
        const res: ValidationProblem[] = validate(param, meta, undefined, param);
        if (res.length) {
            throw new ValidationError('header', res);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validatePathParam(param: unknown, meta: PathParamMetadata): void {
        const validate: PathParamValidationFunction | undefined = this.pathParamValidationFunctions[meta.type];
        if (validate == undefined) {
            throw new Error(`Unknown type for path parameter "${meta.name}": ${meta.type}`);
        }
        const res: ValidationProblem[] = validate(param, meta, undefined, param);
        if (res.length) {
            throw new ValidationError('path', res);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateQueryParam(param: unknown, meta: QueryParamMetadata): void {
        const validate: QueryParamValidationFunction | undefined = this.queryParamValidationFunctions[meta.type];
        if (validate == undefined) {
            throw new Error(`Unknown type for query parameter "${meta.name}": ${meta.type}`);
        }
        const res: ValidationProblem[] = validate(param, meta, undefined, param);
        if (res.length) {
            throw new ValidationError('query', res);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateBody(body: unknown, meta: BodyMetadata): void {
        // eslint-disable-next-line jsdoc/require-jsdoc
        class Temp implements OmitStrict<FormData<typeof meta.modelClass>, 'cleanup'> {
            // eslint-disable-next-line jsdoc/require-jsdoc
            @Property.object({ cls: () => meta.modelClass, description: 'the actual data from the request body' })
            value!: typeof meta.modelClass;
            // eslint-disable-next-line jsdoc/require-jsdoc
            @Property.string({ description: 'the path to the temporary folder where uploaded files are cached' })
            tempFolder!: Path;
        }

        const cls: Newable<unknown> = meta.type === MimeType.FORM_DATA ? Temp : meta.modelClass;
        let res: ValidationProblem[];
        if (meta.isArray) {
            if (!Array.isArray(body)) {
                throw new ValidationError('body', [new TypeMismatchValidationProblem('body', 'array')]);
            }
            res = body.reduce<ValidationProblem[]>((prev, curr, i) => [
                ...prev,
                ...this.validateModel(curr, cls, `[${i}]`, meta.allowAdditionalProperties)
            ], []);
        }
        else {
            res = this.validateModel(body, cls, undefined, meta.allowAdditionalProperties);
        }
        if (res.length) {
            throw new ValidationError('body', res);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateWebsocketRequest(req: unknown): void {
        const res: ValidationProblem[] = this.validateModel(req, WebsocketRequest, undefined, false);
        if (res.length) {
            throw new ValidationError('websocketRequest', res);
        }

        // // validate query
        // for (const key in req.query) {
        //     if (typeof req.query[key] != 'string' || typeof req.query[key] != 'undefined') {
        //         res.push({ key, message: 'needs to be a string or undefined' });
        //     }
        // }
        // // validate headers
        // for (const key in req.headers) {
        //     if (!isKnownHeader(key)) {
        //         res.push({ key, message: 'this key is not a known header' });
        //     }
        //     else if (typeof req.headers[key] != 'string' || typeof req.headers[key] != 'undefined') {
        //         res.push({ key, message: 'needs to be a string or undefined' });
        //     }
        // }
        // // validate params
        // for (const key in req.params) {
        //     if (typeof req.params[key] != 'string' || typeof req.params[key] != 'undefined') {
        //         res.push({ key, message: 'needs to be a string or undefined' });
        //     }
        // }
        // if (res.length) {
        //     throw new ValidationError('websocketRequest', res);
        // }
    }

    private validateModel(
        body: unknown,
        cls: Newable<unknown>,
        parentKey: string | undefined,
        allowAdditionalProperties: boolean
    ): ValidationProblem[] {
        const modelProperties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);

        const keysOfBody: string[] = ObjectUtilities.keys(body as Record<string, unknown>);
        const keysOfModel: string[] = ObjectUtilities.keys(modelProperties);
        const unknownKeys: string[] = keysOfBody.filter(k => !keysOfModel.includes(k));
        const res: ValidationProblem[] = [];
        for (const key of unknownKeys) {
            if (allowAdditionalProperties) {
                continue;
            }
            const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
            res.push({ key: fullKey, message: 'this key is unknown' });
        }
        for (const [propertyKey, metadata] of ObjectUtilities.entries(modelProperties)) {
            const property: unknown = (body as Record<string, unknown>)[propertyKey];
            const errors: ValidationProblem[] = this.validateProperty(propertyKey, property, metadata, parentKey, body);
            res.push(...errors);
        }
        return res;
    }

    private validateProperty(
        key: string,
        property: unknown,
        metadata: PropertyMetadata,
        parentKey: string | undefined,
        entity: unknown | undefined
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
        const res: ValidationProblem[] = validate(key, property, metadata, parentKey, entity);
        return res;
    }

    private validateArrayProperty(
        key: string,
        property: unknown,
        metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
        parentKey: string | undefined,
        entity: unknown | undefined
    ): ValidationProblem[] {
        if (metadata.type !== 'array') {
            throw new Error('Tried to do array based validation on a non array value.');
        }
        const fullKey: string = parentKey ? `${parentKey}.${key}` : key;

        const required: boolean = typeof metadata.required === 'boolean' ? metadata.required : metadata.required(entity);
        if (property == undefined && required) {
            return [new IsRequiredValidationProblem(fullKey)];
        }
        if (property == undefined && !required) {
            return [];
        }
        if (!Array.isArray(property)) {
            return [new TypeMismatchValidationProblem(fullKey, 'array')];
        }

        const res: ValidationProblem[] = [];
        for (let i: number = 0; i < property.length; i++) {
            const item: unknown = property[i];
            const errors: ValidationProblem[] = this.validateProperty(String(i), item, metadata.items as PropertyMetadata, key, entity);
            res.push(...errors);
        }
        return res;
    }

    private validateObjectProperty(
        key: string,
        property: unknown,
        metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
        parentKey: string | undefined,
        entity: unknown | undefined
    ): ValidationProblem[] {
        if (metadata.type !== 'object') {
            throw new Error('Tried to do object based validation on a non object value.');
        }
        const fullKey: string = parentKey ? `${parentKey}.${key}` : key;

        const required: boolean = typeof metadata.required === 'boolean' ? metadata.required : metadata.required(entity);
        if (property == undefined && required) {
            return [new IsRequiredValidationProblem(fullKey)];
        }
        if (property == undefined && !required) {
            return [];
        }
        if (typeof property !== 'object') {
            return [new TypeMismatchValidationProblem(fullKey, 'object')];
        }

        const objectProperties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(metadata.cls());

        const res: ValidationProblem[] = [];

        if (!metadata.allowAdditionalProperties) {
            const keysOfBody: string[] = ObjectUtilities.keys(property as Record<string, unknown>);
            const keysOfModel: string[] = ObjectUtilities.keys(objectProperties);
            const unknownKeys: string[] = keysOfBody.filter(k => !keysOfModel.includes(k));

            for (const k of unknownKeys) {
                res.push({ key: k, message: 'this key is unknown' });
            }
            if (res.length) {
                throw new ValidationError('body', res);
            }
        }

        for (const [propertyKey, m] of ObjectUtilities.entries(objectProperties)) {
            const childProperty: unknown = (property as Record<string, unknown>)[propertyKey];
            const errors: ValidationProblem[] = this.validateProperty(propertyKey, childProperty, m, key, entity);
            res.push(...errors);
        }
        return res;
    }
}