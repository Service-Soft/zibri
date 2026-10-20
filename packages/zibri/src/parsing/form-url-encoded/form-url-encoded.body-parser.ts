import { PropertyMetadata } from '../../entity/decorators/property.decorator.ts';
import { BadRequestError } from '../../error-handling/errors/bad-request.error.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { HttpRequest } from '../../http/http-request.model.ts';
import { MimeType } from '../../http/mime-type.enum.ts';
import { HttpClientResponse } from '../../http-client/http-client-response.model.ts';
import { $ts } from '../../localization/translate.function.ts';
import { BodyShapeMetadata, FormUrlEncodedBodyMetadata } from '../../routing/decorators/body-metadata.model.ts';
import { resolveMaxBodySize } from '../../routing/decorators/body.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { shapeProblems } from '../../validation/functions/shape-problems.function.ts';
import { BodyParserInterface } from '../body-parser.interface.ts';
import { BodyParserUtilities } from '../body-parser.utilities.ts';
import { BodyParser } from '../decorators/body-parser.decorator.ts';
import { parseFormField } from '../functions/parse-form-field.function.ts';

/**
 * The fields of a form, by name. A field sent more than once has each of its texts, in order.
 */
type FormFields = Map<string, string | string[]>;

/**
 * Body parser for url encoded forms, what an html form sends without files. Only works with http
 * requests and responses.
 *
 * Each field fills the property of the same name, read as that property's type. A field sent more
 * than once fills a list.
 */
@BodyParser()
export class FormUrlEncodedBodyParser implements BodyParserInterface<MimeType.FORM_URL_ENCODED> {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly contentType: MimeType.FORM_URL_ENCODED = MimeType.FORM_URL_ENCODED;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    parseFromWebsocketRequest(): unknown {
        throw new InternalError('A url encoded form body cannot be used with websocket requests');
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    parseFromHttpClientResponse(res: HttpClientResponse, metadata: FormUrlEncodedBodyMetadata): unknown {
        if (res.body !== undefined) {
            return res.body;
        }
        return this.parseForm(res.rawBody, metadata.shape);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async parseFromHttpRequest(req: HttpRequest, metadata: FormUrlEncodedBodyMetadata): Promise<unknown> {
        if (req.body !== undefined) {
            return req.body;
        }
        const raw: Buffer = await BodyParserUtilities.readRequestBodyIntoMemory(req, resolveMaxBodySize(metadata));
        return this.parseForm(raw.length ? raw.toString('utf8') : undefined, metadata.shape);
    }

    private parseForm(text: unknown, shape: BodyShapeMetadata): unknown {
        if (text == undefined) {
            return undefined;
        }
        if (typeof text !== 'string') {
            throw new BadRequestError($ts`A url encoded form has to be sent as text.`);
        }
        const fields: FormFields = new Map();
        for (const [name, value] of new URLSearchParams(text)) {
            const current: string | string[] | undefined = fields.get(name);
            fields.set(name, current == undefined ? value : [...typeof current === 'string' ? [current] : current, value]);
        }
        return this.toValue(fields, shape);
    }

    /**
     * Reads a form as the class, or the first of several classes, it is declared as.
     * @param fields - The fields the form carried.
     * @param shape - What the form is declared as.
     * @returns The value of the form.
     * @throws When the form is declared as something other than a class, or several classes.
     */
    private toValue(fields: FormFields, shape: BodyShapeMetadata): object {
        switch (shape.type) {
            case 'object': {
                return this.toObject(fields, shape.cls());
            }
            case 'anyOf': {
                const candidates: object[] = [];
                for (const candidate of shape.shapes) {
                    if (candidate.type !== 'object') {
                        throw new InternalError('Each shape of a url encoded form body has to be a class.');
                    }
                    const value: object = this.toObject(fields, candidate.cls());
                    if (!shapeProblems('', value, candidate).length) {
                        return value;
                    }
                    candidates.push(value);
                }
                // read as the first class when it fits none, so that validation reports every class
                // against what the form carried
                return candidates[0] ?? {};
            }
            case 'string':
            case 'number':
            case 'boolean':
            case 'date':
            case 'array':
            case 'unknown': {
                throw new InternalError('A url encoded form body has to be a class, or one of several classes.');
            }
        }
    }

    private toObject(fields: FormFields, cls: Newable<unknown>): object {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        // built from entries, so a field named after a member of every object, like `__proto__`, is a
        // field of its own rather than a change to what the object is
        return Object.fromEntries([...fields].map(([name, value]) => [
            name,
            parseFormField(value, Object.hasOwn(properties, name) ? properties[name] : undefined)
        ]));
    }
}