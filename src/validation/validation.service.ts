import { MetadataUtilities } from '../encapsulation';
import { ArrayPropertyMetadata, PropertyMetadata } from '../entity';
import { ValidationError } from '../error-handling';
import { ArrayQueryParamMetadata, HeaderParamMetadata, PathParamMetadata, QueryParamMetadata } from '../routing';
import { Newable } from '../types';
import { validateBooleanHeaderParam, validateBooleanQueryParam, validateDateHeaderParam, validateDateQueryParam, validateNumberPathParam, validateNumberProperty, validateNumberQueryParam, validateStringHeaderParam, validateStringPathParam, validateStringProperty, validateStringQueryParam } from './functions';
import { validateNumberHeaderParam } from './functions/validate-number-header-param.function';
import { IsRequiredValidationProblem, ValidationProblem } from './validation-problem.model';
import { ValidationServiceInterface } from './validation-service.interface';

type PathParamValidationFunction = (param: unknown, meta: PathParamMetadata) => ValidationProblem[];

type QueryParamValidationFunction = (param: unknown, meta: QueryParamMetadata, parentKey: string | undefined) => ValidationProblem[];

type HeaderParamValidationFunction = (param: unknown, meta: HeaderParamMetadata) => ValidationProblem[];

type PropertyValidationFunction = (
    key: string,
    property: unknown,
    metadata: PropertyMetadata,
    parentKey: string | undefined
) => ValidationProblem[];

export class ValidationService implements ValidationServiceInterface {

    private readonly pathParamValidationFunctions: Record<PathParamMetadata['type'], PathParamValidationFunction> = {
        string: validateStringPathParam,
        number: validateNumberPathParam
    };

    private readonly queryParamValidationFunctions: Record<QueryParamMetadata['type'], QueryParamValidationFunction> = {
        string: validateStringQueryParam,
        number: validateNumberQueryParam,
        boolean: validateBooleanQueryParam,
        date: validateDateQueryParam,
        object: this.validateObjectQueryParam.bind(this),
        array: this.validateArrayQueryParam.bind(this)
    };

    private readonly headerParamValidationFunctions: Record<HeaderParamMetadata['type'], HeaderParamValidationFunction> = {
        string: validateStringHeaderParam,
        number: validateNumberHeaderParam,
        boolean: validateBooleanHeaderParam,
        date: validateDateHeaderParam
    };

    private readonly propertyValidationFunctions: Record<PropertyMetadata['type'], PropertyValidationFunction> = {
        object: this.validateObjectProperty.bind(this),
        array: this.validateArrayProperty.bind(this),
        number: validateNumberProperty,
        string: validateStringProperty
    };

    private validateObjectQueryParam(param: unknown, meta: QueryParamMetadata, parentKey: string | undefined): ValidationProblem[] {
        const fullKey: string = parentKey ? `${parentKey}.${meta.name}` : meta.name;
        if (meta.type !== 'object') {
            throw new Error('Tried to do object based validation on a non object value.');
        }

        if (param == undefined && meta.required) {
            return [new IsRequiredValidationProblem(fullKey)];
        }
        if (param == undefined && !meta.required) {
            return [];
        }
        if (typeof param !== 'object') {
            return [{ key: fullKey, message: 'should be an object' }];
        }
        return this.validateModel(param, meta.cls, fullKey);
    }

    private validateArrayQueryParam(param: unknown, meta: QueryParamMetadata, parentKey: string | undefined): ValidationProblem[] {
        const fullKey: string = parentKey ? `${parentKey}.${meta.name}` : meta.name;
        if (meta.type !== 'array') {
            throw new Error('Tried to do array based validation on a non array value.');
        }
        if (param == undefined && meta.required) {
            return [new IsRequiredValidationProblem(fullKey)];
        }
        if (param == undefined && !meta.required) {
            return [];
        }
        if (!Array.isArray(param)) {
            return [{ key: meta.name, message: 'should be an array' }];
        }

        const res: ValidationProblem[] = [];
        for (let i: number = 0; i < param.length; i++) {
            const item: unknown = param[i];
            const m: QueryParamMetadata = this.getQueryArrayItemMetadata(i, meta);
            const validate: QueryParamValidationFunction | undefined = this.queryParamValidationFunctions[m.type];
            if (validate == undefined) {
                throw new Error(`Unknown type for query parameter "${fullKey}.${m.name}": ${m.type}`);
            }
            const errors: ValidationProblem[] = validate(item, m, fullKey);
            res.push(...errors);
        }
        return res;
    }

    validateHeaderParam(param: unknown, meta: HeaderParamMetadata): void {
        const validate: HeaderParamValidationFunction | undefined = this.headerParamValidationFunctions[meta.type];
        if (validate == undefined) {
            throw new Error(`Unknown type for header parameter "${meta.name}": ${meta.type}`);
        }
        const res: ValidationProblem[] = validate(param, meta);
        if (res.length) {
            throw new ValidationError('header', res);
        }
    }

    validatePathParam(param: unknown, meta: PathParamMetadata): void {
        const validate: PathParamValidationFunction | undefined = this.pathParamValidationFunctions[meta.type];
        if (validate == undefined) {
            throw new Error(`Unknown type for path parameter "${meta.name}": ${meta.type}`);
        }
        const res: ValidationProblem[] = validate(param, meta);
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

    validateRequestBody(model: unknown, cls: Newable<unknown>): void {
        const res: ValidationProblem[] = this.validateModel(model, cls, undefined);
        if (res.length) {
            throw new ValidationError('body', res);
        }
    }

    private validateModel(model: unknown, cls: Newable<unknown>, parentKey: string | undefined): ValidationProblem[] {
        const modelProperties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);

        const keysOfBody: string[] = Object.keys(model as Record<string, unknown>);
        const keysOfModel: string[] = Object.keys(modelProperties);
        const unknownKeys: string[] = keysOfBody.filter(k => !keysOfModel.includes(k));
        const res: ValidationProblem[] = [];
        for (const key of unknownKeys) {
            const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
            res.push({ key: fullKey, message: 'this key is unknown' });
        }
        for (const [propertyKey, metadata] of Object.entries(modelProperties)) {
            const property: unknown = (model as Record<string, unknown>)[propertyKey];
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
        metadata: PropertyMetadata,
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
            return [{ key: fullKey, message: 'should be an array' }];
        }

        const res: ValidationProblem[] = [];
        for (let i: number = 0; i < property.length; i++) {
            const item: unknown = property[i];
            const m: PropertyMetadata = this.getPropertyArrayItemMetadata(metadata);
            const errors: ValidationProblem[] = this.validateProperty(String(i), item, m, key);
            res.push(...errors);
        }
        return res;
    }

    private getPropertyArrayItemMetadata(metadata: ArrayPropertyMetadata): PropertyMetadata {
        switch (metadata.itemType) {
            case 'number': {
                return {
                    type: 'number',
                    required: true
                };
            }
            case 'string': {
                return {
                    type: 'string',
                    required: true
                };
            }
            default: {
                return {
                    type: 'object',
                    cls: metadata.itemType,
                    required: true
                };
            }
        }
    }

    private getQueryArrayItemMetadata(index: number, metadata: ArrayQueryParamMetadata): QueryParamMetadata {
        switch (metadata.itemType) {
            case 'date':
            case 'string':
            case 'boolean':
            case 'number': {
                return {
                    name: String(index),
                    type: metadata.itemType,
                    required: true
                };
            }
            default: {
                return {
                    name: String(index),
                    type: 'object',
                    cls: metadata.itemType,
                    required: true
                };
            }
        }
    }

    private validateObjectProperty(
        key: string,
        property: unknown,
        metadata: PropertyMetadata,
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
            return [{ key: fullKey, message: 'should be an object' }];
        }

        const objectProperties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(metadata.cls);
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