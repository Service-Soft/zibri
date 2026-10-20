import { IsRequiredValidationProblem, NoShapeFitsValidationProblem, RelationsNotAllowedValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from './validation-problem.model.ts';
import { ValidationServiceInterface } from './validation-service.interface.ts';
import { HttpRequestContext } from '../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../context/request/websocket-request.context.ts';
import { BaseEntity } from '../entity/base-entity.model.ts';
import { namedShapeOf, NamedShape } from './functions/shape-problems.function.ts';
import { validateBoolean } from './functions/validate-boolean.function.ts';
import { validateDate } from './functions/validate-date.function.ts';
import { validateFile } from './functions/validate-file.function.ts';
import { validateNumber } from './functions/validate-number.function.ts';
import { validateString } from './functions/validate-string.function.ts';
import { Injectable } from '../di/decorators/injectable.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { PropertyMetadata, RelationMetadata } from '../entity/decorators/property.decorator.ts';
import { BasePropertyMetadata } from '../entity/models/base-property-metadata.model.ts';
import { AnyOfShapesMetadata } from '../entity/models/one-of-property-metadata.model.ts';
import { RelationType } from '../entity/models/relation-type.enum.ts';
import { ValidationError } from '../error-handling/errors/validation.error.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { MimeType } from '../http/mime-type.enum.ts';
import { $ts } from '../localization/translate.function.ts';
import { chooseShape, ShapeChoice } from '../parsing/functions/parse-one-of.function.ts';
import { BodyMetadata, BodyShapeMetadata } from '../routing/decorators/body-metadata.model.ts';
import { PathParamMetadata, QueryParamMetadata, HeaderParamMetadata } from '../routing/decorators/param.decorator.ts';
import { ExcludeStrict } from '../types/exclude-strict.type.ts';
import { Newable } from '../types/newable.type.ts';
import { MetadataUtilities } from '../utilities/metadata.utilities.ts';
import { ObjectUtilities } from '../utilities/object.utilities.ts';
import { WebsocketRequest } from '../websocket/models/websocket-request.model.ts';

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
        date: (param, meta, parentKey, entity) => validateDate(meta.name, param, meta, parentKey, entity),
        oneOf: (param, meta, parentKey, entity) => this.validateAnyOfParam(param, meta, parentKey, entity)
    };

    private readonly queryParamValidationFunctions: Record<QueryParamMetadata['type'], QueryParamValidationFunction> = {
        string: (param, meta, parentKey, entity) => validateString(meta.name, param, meta, parentKey, entity),
        number: (param, meta, parentKey, entity) => validateNumber(meta.name, param, meta, parentKey, entity),
        boolean: (param, meta, parentKey, entity) => validateBoolean(meta.name, param, meta, parentKey, entity),
        date: (param, meta, parentKey, entity) => validateDate(meta.name, param, meta, parentKey, entity),
        object: (param, meta, parentKey, entity) => this.validateObjectProperty(meta.name, param, meta, parentKey, entity),
        array: (param, meta, parentKey, entity) => this.validateArrayProperty(meta.name, param, meta, parentKey, entity),
        oneOf: (param, meta, parentKey, entity) => this.validateAnyOfParam(param, meta, parentKey, entity)
    };

    private readonly headerParamValidationFunctions: Record<HeaderParamMetadata['type'], HeaderParamValidationFunction> = {
        string: (param, meta, parentKey, entity) => validateString(meta.name, param, meta, parentKey, entity),
        number: (param, meta, parentKey, entity) => validateNumber(meta.name, param, meta, parentKey, entity),
        boolean: (param, meta, parentKey, entity) => validateBoolean(meta.name, param, meta, parentKey, entity),
        date: (param, meta, parentKey, entity) => validateDate(meta.name, param, meta, parentKey, entity),
        object: (param, meta, parentKey, entity) => this.validateObjectProperty(meta.name, param, meta, parentKey, entity),
        array: (param, meta, parentKey, entity) => this.validateArrayProperty(meta.name, param, meta, parentKey, entity),
        oneOf: (param, meta, parentKey, entity) => this.validateAnyOfParam(param, meta, parentKey, entity)
    };

    private readonly propertyValidationFunctions: Record<ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity>>['type'], PropertyValidationFunction> = {
        object: this.validateObjectProperty.bind(this),
        array: this.validateArrayProperty.bind(this),
        number: validateNumber,
        string: validateString,
        date: validateDate,
        boolean: validateBoolean,
        file: validateFile,
        unknown: () => [],
        oneOf: this.validateOneOfProperty.bind(this)
    };

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async validateBody(body: unknown, meta: BodyMetadata): Promise<void> {
        const res: ValidationProblem[] = await this.getBodyValidationProblems(body, meta);
        if (res.length) {
            throw new ValidationError('body', undefined, res);
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async getBodyValidationProblems(body: unknown, meta: BodyMetadata): Promise<ValidationProblem[]> {
        if (body == undefined) {
            const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
            const isRequired: boolean = typeof meta.required === 'boolean' ? meta.required : await meta.required(undefined, context);
            return isRequired ? [new IsRequiredValidationProblem('body')] : [];
        }

        switch (meta.type) {
            case MimeType.JSON:
            case MimeType.JSON_LD:
            case MimeType.JSON_SCIM:
            case MimeType.XML:
            case MimeType.FORM_URL_ENCODED: {
                return this.problemsOfBodyItself(await this.validateBodyShape(body, meta.shape));
            }
            case MimeType.FORM_DATA: {
                // a form is read into a value and a folder its files were written to. The folder is ours rather
                // than the caller's, so only the value is reported the way the caller sent it
                if (typeof body !== 'object' || body === null || !('tempFolder' in body) || typeof body.tempFolder !== 'string') {
                    return [new IsRequiredValidationProblem('tempFolder')];
                }
                const value: unknown = 'value' in body ? body.value : undefined;
                return this.problemsOfBodyItself(await this.validateBodyShape(value, meta.shape));
            }
            case MimeType.OCTET_STREAM: {
                // The parsed stream enforces maxSize as it is consumed, which means there is nothing left here.
                return [];
            }
        }
    }

    private async validateBodyShape(body: unknown, shape: BodyShapeMetadata): Promise<ValidationProblem[]> {
        return shape.type === 'anyOf'
            ? await this.validateAnyOf('', body, { shapes: shape.shapes, required: true }, undefined, body)
            : await this.validateProperty('', body, shape, undefined, body);
    }

    /**
     * Names the body in a problem that is about the body as a whole rather than something inside it.
     * @param problems - The problems, with the body itself under an empty key.
     * @returns The same problems, with the body itself under `body`.
     */
    private problemsOfBodyItself(problems: ValidationProblem[]): ValidationProblem[] {
        return problems.map(problem => problem.key === '' ? { key: 'body', message: problem.message } : problem);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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
            ObjectUtilities.entries(modelProperties).map(async ([k, metadata]) => {
                const property: unknown = (body as Record<string, unknown>)[k];
                const errors: ValidationProblem[] = await this.validateProperty(k, property, metadata, parentKey, body);
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
            metadata.type === RelationType.MANY_TO_ONE
            || metadata.type === RelationType.ONE_TO_MANY
            || metadata.type === RelationType.HAS_ONE
            || metadata.type === RelationType.BELONGS_TO_ONE
            || metadata.type === RelationType.MANY_TO_MANY
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
        await Promise.all(property.map(async (_, i) => {
            const item: unknown = property[i];
            const errors: ValidationProblem[] = await this.validateProperty(
                String(i),
                item,
                metadata.items as PropertyMetadata,
                fullKey || undefined,
                entity
            );
            res.push(...errors);
        }));
        return res;
    }

    /**
     * Validates a property that holds one of several named shapes, as the shape it names.
     * @param key - The key of the property.
     * @param property - The value.
     * @param metadata - The metadata of the property.
     * @param parentKey - The key of the parent, if it exists.
     * @param entity - The entity the value belongs to.
     * @returns All validation problems found.
     */
    private async validateOneOfProperty(
        key: string,
        property: unknown,
        metadata: PropertyMetadata,
        parentKey: string | undefined,
        entity: unknown | undefined
    ): Promise<ValidationProblem[]> {
        if (metadata.type !== 'oneOf') {
            throw new InternalError('Tried to validate one of several shapes on a value declared as something else.');
        }
        const fullKey: string = parentKey ? `${parentKey}.${key}` : key;

        if (property == undefined) {
            return await this.problemsOfMissingValue(fullKey, metadata.required, entity);
        }

        const named: NamedShape = namedShapeOf(fullKey, property, metadata);
        if (named.shape == undefined) {
            return named.problems;
        }
        return [...named.problems, ...await this.validateProperty('value', named.value, named.shape, fullKey || undefined, entity)];
    }

    /**
     * Validates a value that is the first of several shapes it fits.
     *
     * The shape is chosen the way parsing chose it - judged by the value alone - and then validated
     * completely, which is where a requirement decided by the request is asked. The value is already
     * parsed by then, and choosing again on a parsed value lands on the same shape.
     * @param key - The key of the value.
     * @param value - The value.
     * @param metadata - The shapes, and whether the value is required.
     * @param parentKey - The key of the parent, if it exists.
     * @param entity - The entity the value belongs to.
     * @returns All validation problems found.
     */
    private async validateAnyOf(
        key: string,
        value: unknown,
        metadata: Pick<AnyOfShapesMetadata, 'shapes'> & Pick<BasePropertyMetadata, 'required'>,
        parentKey: string | undefined,
        entity: unknown | undefined
    ): Promise<ValidationProblem[]> {
        const fullKey: string = parentKey ? `${parentKey}.${key}` : key;

        if (value == undefined) {
            return await this.problemsOfMissingValue(fullKey, metadata.required, entity);
        }

        const choice: ShapeChoice = chooseShape(value, metadata);
        if (!choice.fits) {
            return [new NoShapeFitsValidationProblem(fullKey, choice.attempts)];
        }
        return await this.validateProperty(key, value, choice.shape, parentKey, entity);
    }

    private async validateAnyOfParam(
        param: unknown,
        meta: PathParamMetadata | QueryParamMetadata | HeaderParamMetadata,
        parentKey: string | undefined,
        entity: unknown | undefined
    ): Promise<ValidationProblem[]> {
        if (meta.type !== 'oneOf') {
            throw new InternalError('Tried to validate one of several shapes on a parameter declared as something else.');
        }
        return await this.validateAnyOf(meta.name, param, meta, parentKey, entity);
    }

    private async problemsOfMissingValue(
        fullKey: string,
        required: BasePropertyMetadata['required'],
        entity: unknown | undefined
    ): Promise<ValidationProblem[]> {
        const isRequired: boolean = typeof required === 'boolean'
            ? required
            : await required(entity, inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT));
        return isRequired ? [new IsRequiredValidationProblem(fullKey)] : [];
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
                res.push({ key: fullKey ? `${fullKey}.${k}` : k, message: $ts`this key is unknown` });
            }
        }

        await Promise.all(
            ObjectUtilities.entries(objectProperties).map(async ([propertyKey, m]) => {
                const childProperty: unknown = (property as Record<string, unknown>)[propertyKey];
                const errors: ValidationProblem[]
                    = await this.validateProperty(propertyKey, childProperty, m, fullKey || undefined, entity);
                res.push(...errors);
            })
        );
        return res;
    }
}