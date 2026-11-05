import { ScimBody } from './scim-body.model';
import { ScimSchema } from './scim-schema.enum';

/**
 * What an attribute definition (RFC 7643, 7) may say beside its name and type, where it differs from
 * the defaults.
 */
type ScimAttributeOptions = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    multiValued?: boolean,
    // eslint-disable-next-line jsdoc/require-jsdoc
    required?: boolean,
    // eslint-disable-next-line jsdoc/require-jsdoc
    mutability?: 'readOnly' | 'readWrite' | 'immutable' | 'writeOnly',
    // eslint-disable-next-line jsdoc/require-jsdoc
    returned?: 'always' | 'never' | 'default' | 'request',
    // eslint-disable-next-line jsdoc/require-jsdoc
    uniqueness?: 'none' | 'server' | 'global',
    // eslint-disable-next-line jsdoc/require-jsdoc
    canonicalValues?: string[],
    // eslint-disable-next-line jsdoc/require-jsdoc
    referenceTypes?: string[],
    // eslint-disable-next-line jsdoc/require-jsdoc
    subAttributes?: ScimBody[]
};

/**
 * The schemas (RFC 7643, 8.7.1) of the resources the SCIM routes keep, as the `/Schemas` route
 * answers them.
 */
export abstract class ScimSchemaUtilities {
    /**
     * The schemas of users, of the enterprise extension of users and of groups.
     * @param url - The url of the SCIM routes, which the location of each schema starts with.
     * @returns The schemas.
     */
    static getSchemas(url: string): ScimBody[] {
        const schemas: ScimBody[] = [
            {
                id: ScimSchema.USER,
                name: 'User',
                description: 'User Account',
                attributes: [
                    this.attribute('userName', 'string', { required: true, uniqueness: 'server' }),
                    this.attribute('name', 'complex', {
                        subAttributes: ['formatted', 'familyName', 'givenName', 'middleName', 'honorificPrefix', 'honorificSuffix']
                            .map(name => this.attribute(name, 'string'))
                    }),
                    ...['displayName', 'nickName'].map(name => this.attribute(name, 'string')),
                    this.attribute('profileUrl', 'reference', { referenceTypes: ['external'] }),
                    ...['title', 'userType', 'preferredLanguage', 'locale', 'timezone'].map(name => this.attribute(name, 'string')),
                    this.attribute('active', 'boolean'),
                    this.attribute('password', 'string', { mutability: 'writeOnly', returned: 'never' }),
                    this.listAttribute('emails', ['work', 'home', 'other']),
                    this.listAttribute('phoneNumbers', ['work', 'home', 'mobile', 'fax', 'pager', 'other']),
                    this.listAttribute('ims', ['aim', 'gtalk', 'icq', 'xmpp', 'msn', 'skype', 'qq', 'yahoo']),
                    this.listAttribute('photos', ['photo', 'thumbnail'], 'reference'),
                    this.attribute('addresses', 'complex', {
                        multiValued: true,
                        subAttributes: [
                            ...['formatted', 'streetAddress', 'locality', 'region', 'postalCode', 'country']
                                .map(name => this.attribute(name, 'string')),
                            this.attribute('type', 'string', { canonicalValues: ['work', 'home', 'other'] })
                        ]
                    }),
                    this.attribute('groups', 'complex', {
                        multiValued: true,
                        mutability: 'readOnly',
                        subAttributes: [
                            this.attribute('value', 'string', { mutability: 'readOnly' }),
                            this.attribute('$ref', 'reference', { mutability: 'readOnly', referenceTypes: ['Group'] }),
                            this.attribute('display', 'string', { mutability: 'readOnly' }),
                            this.attribute('type', 'string', { mutability: 'readOnly', canonicalValues: ['direct', 'indirect'] })
                        ]
                    }),
                    this.listAttribute('entitlements', undefined),
                    this.listAttribute('roles', undefined),
                    this.listAttribute('x509Certificates', undefined, 'binary')
                ]
            },
            {
                id: ScimSchema.ENTERPRISE_USER,
                name: 'EnterpriseUser',
                description: 'Enterprise User',
                attributes: [
                    ...['employeeNumber', 'costCenter', 'organization', 'division', 'department']
                        .map(name => this.attribute(name, 'string')),
                    this.attribute('manager', 'complex', {
                        subAttributes: [
                            this.attribute('value', 'string'),
                            this.attribute('$ref', 'reference', { referenceTypes: ['User'] }),
                            this.attribute('displayName', 'string', { mutability: 'readOnly' })
                        ]
                    })
                ]
            },
            {
                id: ScimSchema.GROUP,
                name: 'Group',
                description: 'Group',
                attributes: [
                    this.attribute('displayName', 'string', { required: true }),
                    this.attribute('members', 'complex', {
                        multiValued: true,
                        subAttributes: [
                            this.attribute('value', 'string', { mutability: 'immutable' }),
                            this.attribute('$ref', 'reference', { mutability: 'immutable', referenceTypes: ['User', 'Group'] }),
                            this.attribute('type', 'string', { mutability: 'immutable', canonicalValues: ['User', 'Group'] })
                        ]
                    })
                ]
            }
        ];
        return schemas.map(schema => ({
            schemas: [ScimSchema.SCHEMA],
            ...schema,
            meta: { resourceType: 'Schema', location: `${url}/Schemas/${String(schema['id'])}` }
        }));
    }

    /**
     * An attribute definition, with the defaults of RFC 7643 for whatever the options leave out.
     * @param name - The name of the attribute.
     * @param type - Its type.
     * @param options - What it says beside them.
     * @returns The definition.
     */
    private static attribute(name: string, type: string, options: ScimAttributeOptions = {}): ScimBody {
        return {
            name,
            type,
            multiValued: options.multiValued ?? false,
            required: options.required ?? false,
            caseExact: false,
            mutability: options.mutability ?? 'readWrite',
            returned: options.returned ?? 'default',
            uniqueness: options.uniqueness ?? 'none',
            ...options.canonicalValues == undefined ? {} : { canonicalValues: options.canonicalValues },
            ...options.referenceTypes == undefined ? {} : { referenceTypes: options.referenceTypes },
            ...options.subAttributes == undefined ? {} : { subAttributes: options.subAttributes }
        };
    }

    /**
     * A multi-valued attribute of the shape most of them share: a value, its display name, its type
     * and whether it is the primary one.
     * @param name - The name of the attribute.
     * @param types - The canonical values of its type, if it has some.
     * @param valueType - The type of its value.
     * @returns The definition.
     */
    private static listAttribute(name: string, types: string[] | undefined, valueType: string = 'string'): ScimBody {
        return this.attribute(name, 'complex', {
            multiValued: true,
            subAttributes: [
                this.attribute('value', valueType, valueType === 'reference' ? { referenceTypes: ['external'] } : {}),
                this.attribute('display', 'string'),
                this.attribute('type', 'string', types == undefined ? {} : { canonicalValues: types }),
                this.attribute('primary', 'boolean')
            ]
        });
    }
}