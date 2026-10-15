import { ScimFilterUtilities } from './scim-filter.utilities';
import { ScimUserValue } from './scim-user-value.model';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * A value of a user as it is written, before it has an id, and without the tenant the repository
 * gives it.
 */
type ScimUserValueInput = OmitStrict<ScimUserValue, 'id' | 'tenantId'>;

/**
 * Turns the attributes of a provisioned user into the values filters and sorts find them by.
 */
export abstract class ScimUserValueUtilities {
    /**
     * The values the attributes of a user hold, one for every value of a simple attribute and every
     * sub-attribute of a complex one. Values that are null, empty or neither text, a number nor true
     * or false hold nothing to find a user by.
     * @param scimUserId - The id of the SCIM resource of the user.
     * @param attributes - The attributes not kept in columns of their own.
     * @returns The values.
     */
    static toValues(scimUserId: string, attributes: Record<string, unknown>): ScimUserValueInput[] {
        const values: ScimUserValueInput[] = [];
        for (const [name, value] of Object.entries(attributes)) {
            // an extension keeps its attributes in an object under the urn of its schema
            if (name.includes(':') && ScimFilterUtilities.isRecord(value)) {
                for (const [extensionName, extensionValue] of Object.entries(value)) {
                    values.push(...this.toAttributeValues(scimUserId, `${name}:${extensionName}`.toLowerCase(), extensionValue));
                }
                continue;
            }
            values.push(...this.toAttributeValues(scimUserId, name.toLowerCase(), value));
        }
        return this.markSortValues(values);
    }

    private static toAttributeValues(scimUserId: string, attribute: string, value: unknown): ScimUserValueInput[] {
        const elements: unknown[] = Array.isArray(value) ? value : [value];
        return elements.flatMap((element, index): ScimUserValueInput[] => {
            if (!ScimFilterUtilities.isRecord(element)) {
                return this.toValue(scimUserId, attribute, attribute, index, element);
            }
            return Object.entries(element)
                .flatMap(([name, item]) => this.toValue(scimUserId, attribute, `${attribute}.${name.toLowerCase()}`, index, item));
        });
    }

    private static toValue(scimUserId: string, attribute: string, path: string, element: number, value: unknown): ScimUserValueInput[] {
        const base: OmitStrict<ScimUserValueInput, 'text' | 'number' | 'boolean'> = {
            scimUserId,
            attribute,
            path,
            element,
            sortValue: false
        };
        if (typeof value === 'string' && value !== '') {
            return [{ ...base, text: value.toLowerCase(), number: undefined, boolean: undefined }];
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return [{ ...base, text: undefined, number: value, boolean: undefined }];
        }
        if (typeof value === 'boolean') {
            return [{ ...base, text: undefined, number: undefined, boolean: value }];
        }
        return [];
    }

    /**
     * Marks the value of every path a sort reads: of a multi-valued attribute the one of its primary
     * value, or else of its first one.
     * @param values - The values of a user.
     * @returns The values, marked.
     */
    private static markSortValues(values: ScimUserValueInput[]): ScimUserValueInput[] {
        const primaryElements: Set<string> = new Set(
            values.filter(value => value.path === `${value.attribute}.primary` && value.boolean === true)
                .map(value => `${value.attribute}#${value.element}`)
        );
        const chosen: Map<string, ScimUserValueInput> = new Map();
        for (const value of values) {
            const current: ScimUserValueInput | undefined = chosen.get(value.path);
            const primary: boolean = primaryElements.has(`${value.attribute}#${value.element}`);
            if (current == undefined || (primary && !primaryElements.has(`${current.attribute}#${current.element}`))) {
                chosen.set(value.path, value);
            }
        }
        const marked: Set<ScimUserValueInput> = new Set(chosen.values());
        return values.map(value => ({ ...value, sortValue: marked.has(value) }));
    }
}