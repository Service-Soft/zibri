import { type FileMirrorShareLinkInputModel } from 'zibri-contract';

import { Property } from '../entity/decorators/property.decorator';
import { ZIBRI_FILE_MIRROR_LIMITS } from './file-mirror-limits.model';

/**
 * What a share link of a mirrored file or folder is asked for with, as `POST /share-links` of the
 * `FileMirrorController` takes it.
 */
export class FileMirrorShareLinkInput implements FileMirrorShareLinkInputModel {
    /**
     * The id of the `TenantWebDavConnection` of the tenant, of the kind `NEXTCLOUD`.
     */
    @Property.string({ format: 'uuid' })
    connectionId!: string;

    /**
     * The path of the file or the folder, relative to the url of the connection, such as `Customers/Ada Lovelace`.
     */
    @Property.string({ minLength: 1, maxLength: ZIBRI_FILE_MIRROR_LIMITS.PATH_MAX_LENGTH })
    path!: string;

    /**
     * The password the link asks for. A link without one opens for anyone who has it.
     */
    @Property.string({ minLength: 1, maxLength: ZIBRI_FILE_MIRROR_LIMITS.PASSWORD_MAX_LENGTH, required: false })
    password?: string;

    /**
     * The day the link expires at the end of, such as `2027-01-31`. A link without one does not expire.
     */
    @Property.string({ regex: /^\d{4}-\d{2}-\d{2}$/, required: false })
    expiresOn?: string;
}
