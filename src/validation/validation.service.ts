import { IsRequiredValidationProblem, RelationsNotAllowedValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from './validation-problem.model';
import { ValidationServiceInterface } from './validation-service.interface';
import { BaseEntity } from '../entity/base-entity.model';
import { validateBoolean } from './functions/validate-boolean.function';
import { validateDate } from './functions/validate-date.function';
import { validateFile } from './functions/validate-file.function';
import { validateNumber } from './functions/validate-number.function';
import { validateString } from './functions/validate-string.function';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { PropertyMetadata, Property, RelationMetadata } from '../entity/decorators/property.decorator';
import { Relation } from '../entity/models/relation.enum';
import { ValidationError } from '../error-handling/errors/validation.error';
import { InternalError } from '../error-handling/internal-error.model';
import { MimeType } from '../http/mime-type.enum';
import { $ts } from '../localization/translate.function';
import { FormData } from '../parsing/form-data/form-data.model';
import { BodyMetadata } from '../routing/decorators/body.decorator';
import { PathParamMetadata, QueryParamMetadata, HeaderParamMetadata } from '../routing/decorators/param.decorator';
import { ExcludeStrict } from '../types/exclude-strict.type';
import { Newable } from '../types/newable.type';
import { OmitStrict } from '../types/omit-strict.type';
import { type FsPath } from '../utilities/fs.utilities';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import { WebsocketRequest } from '../websocket/models/websocket-request.model';

/**
 * Function for validating a path parameter.
 */
type PathParamValidationFunction = (
    param: unknown,
    meta: PathParamMetadata,
    parentKey: string | undefined,
    entity: unknown | undefined
) => ValidationProblem[] | Promise<ValidationProblem[]>;

/**
 * Function for validating a query parameter.
 */
type QueryParamValidationFunction = (
    param: unknown,
    meta: QueryParamMetadata,
    parentKey: string | undefined,
    entity: unknown | undefined
) => ValidationProblem[] | Promise<ValidationProblem[]>;

/**
 * Function for validating a header parameter.
 */
type HeaderParamValidationFunction = (
    param: unknown,
    meta: HeaderParamMetadata,
    parentKey: string | undefined,
    entity: unknown | undefined
) => ValidationProblem[] | Promise<ValidationProblem[]>;

/**
 * Function for validating a single property.
 */
type PropertyValidationFunction = (
    key: string,
    property: unknown,
    metadata: PropertyMetadata,
    parentKey: string | undefined,
    entity: unknown | undefined
) => ValidationProblem[] | Promise<ValidationProblem[]>;

/**
 * The default validation service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
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
    async validateHeaderParam(param: unknown, meta: HeaderParamMetadata): Promise<void> {
        const validate: HeaderParamValidationFunction | undefined = this.headerParamValidationFunctions[meta.type];
        if (validate == undefined) {
            throw new InternalError(`Unknown type for header parameter "${meta.name}": ${meta.type}`);
        }
        const res: ValidationProblem[] = await validate(param, meta, undefined, param);
        if (res.length) {
            throw new ValidationError('header', meta.name, res);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validatePathParam(param: unknown, meta: PathParamMetadata): Promise<void> {
        const validate: PathParamValidationFunction | undefined = this.pathParamValidationFunctions[meta.type];
        if (validate == undefined) {
            throw new InternalError(`Unknown type for path parameter "${meta.name}": ${meta.type}`);
        }
        const res: ValidationProblem[] = await validate(param, meta, undefined, param);
        if (res.length) {
            throw new ValidationError('path', meta.name, res);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validateQueryParam(param: unknown, meta: QueryParamMetadata): Promise<void> {
        const validate: QueryParamValidationFunction | undefined = this.queryParamValidationFunctions[meta.type];
        if (validate == undefined) {
            throw new InternalError(`Unknown type for query parameter "${meta.name}": ${meta.type}`);
        }
        const res: ValidationProblem[] = await validate(param, meta, undefined, param);
        if (res.length) {
            throw new ValidationError('query', meta.name, res);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validateBody(body: unknown, meta: BodyMetadata): Promise<void> {
        const res: ValidationProblem[] = await this.getBodyValidationProblems(body, meta);
        if (res.length) {
            throw new ValidationError('body', undefined, res);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async getBodyValidationProblems(body: unknown, meta: BodyMetadata): Promise<ValidationProblem[]> {
        // eslint-disable-next-line jsdoc/require-jsdoc
        class Temp implements OmitStrict<FormData<typeof meta.modelClass>, 'cleanup'> {
            // eslint-disable-next-line jsdoc/require-jsdoc
            @Property.object({ cls: () => meta.modelClass, description: 'the actual data from the request body' })
            value!: typeof meta.modelClass;
            // eslint-disable-next-line jsdoc/require-jsdoc
            @Property.string({ description: 'the path to the temporary folder where uploaded files are cached' })
            tempFolder!: FsPath;
        }

        const cls: Newable<unknown> = meta.type === MimeType.FORM_DATA ? Temp : meta.modelClass;
        if (meta.isArray) {
            if (!Array.isArray(body)) {
                return [new TypeMismatchValidationProblem('body', 'array')];
            }
            const res: ValidationProblem[] = [];
            await Promise.all(body.map(async (v, i) => {
                res.push(...await this.validateModel(v, cls, `[${i}]`, meta.allowAdditionalProperties));
            }));
            return res;
        }

        return await this.validateModel(body, cls, undefined, meta.allowAdditionalProperties);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validateWebsocketRequest(req: unknown): Promise<void> {
        const res: ValidationProblem[] = await this.validateModel(req, WebsocketRequest, undefined, false);
        if (res.length) {
            throw new ValidationError('websocketRequest', undefined, res);
        }
    }

    private async validateModel(
        body: unknown,
        cls: Newable<unknown>,
        parentKey: string | undefined,
        allowAdditionalProperties: boolean
    ): Promise<ValidationProblem[]> {
        const modelProperties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);

        const keysOfBody: string[] = ObjectUtilities.keys(body as Record<string, unknown>);
        const keysOfModel: string[] = ObjectUtilities.keys(modelProperties);
        const unknownKeys: string[] = keysOfBody.filter(k => !keysOfModel.includes(k));
        const res: ValidationProblem[] = [];
        if (!allowAdditionalProperties) {
            for (const key of unknownKeys) {
                const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
                res.push({ key: fullKey, message: $ts`this key is unknown` });
            }
        }
        await Promise.all(
            keysOfModel.map(async k => {
                const property: unknown = (body as Record<string, unknown>)[k];
                const errors: ValidationProblem[] = await this.validateProperty(k, property, modelProperties[k], parentKey, body);
                res.push(...errors);
            })
        );
        return res;
    }

    private async validateProperty(
        key: string,
        property: unknown,
        metadata: PropertyMetadata,
        parentKey: string | undefined,
        entity: unknown | undefined
    ): Promise<ValidationProblem[]> {
        const fullKey: string = parentKey ? `${parentKey}.${key}` : key;

        if (
            metadata.type === Relation.MANY_TO_ONE
            || metadata.type === Relation.ONE_TO_MANY
            || metadata.type === Relation.HAS_ONE
            || metadata.type === Relation.BELONGS_TO_ONE
            || metadata.type === Relation.MANY_TO_MANY
        ) {
            return [new RelationsNotAllowedValidationProblem(fullKey, metadata, key)];
        }

        const validate: PropertyValidationFunction | undefined = this.propertyValidationFunctions[metadata.type];
        if (validate == undefined) {
            throw new InternalError(`Unknown type for property "${fullKey}": ${metadata.type}`);
        }
        const res: ValidationProblem[] = await validate(key, property, metadata, parentKey, entity);
        return res;
    }

    private async validateArrayProperty(
        key: string,
        property: unknown,
        metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
        parentKey: string | undefined,
        entity: unknown | undefined
    ): Promise<ValidationProblem[]> {
        if (metadata.type !== 'array') {
            throw new InternalError('Tried to do array based validation on a non array value.');
        }
        const fullKey: string = parentKey ? `${parentKey}.${key}` : key;

        const required: boolean = typeof metadata.required === 'boolean'
            ? metadata.required
            : await metadata.required(entity, inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT));
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
        await Promise.all(property.map(async (v, i) => {
            const item: unknown = property[i];
            const errors: ValidationProblem[] = await this.validateProperty(
                String(i),
                item,
                metadata.items as PropertyMetadata,
                key,
                entity
            );
            res.push(...errors);
        }));
        return res;
    }

    private async validateObjectProperty(
        key: string,
        property: unknown,
        metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
        parentKey: string | undefined,
        entity: unknown | undefined
    ): Promise<ValidationProblem[]> {
        if (metadata.type !== 'object') {
            throw new InternalError('Tried to do object based validation on a non object value.');
        }
        const fullKey: string = parentKey ? `${parentKey}.${key}` : key;

        const required: boolean = typeof metadata.required === 'boolean'
            ? metadata.required
            : await metadata.required(entity, inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT));
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
                res.push({ key: k, message: $ts`this key is unknown` });
            }
            if (res.length) {
                throw new ValidationError('body', undefined, res);
            }
        }

        await Promise.all(
            ObjectUtilities.entries(objectProperties).map(async ([propertyKey, m]) => {
                const childProperty: unknown = (property as Record<string, unknown>)[propertyKey];
                const errors: ValidationProblem[] = await this.validateProperty(propertyKey, childProperty, m, key, entity);
                res.push(...errors);
            })
        );
        return res;
    }
}