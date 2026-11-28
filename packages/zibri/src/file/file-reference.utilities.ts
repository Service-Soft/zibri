import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { FileRecord } from './file-record.model';
import { FileReference } from './file-reference.model';
import { FileServiceInterface } from './file-service.interface';

/**
 * The id of a file kept in a file store that a response holds, which a `FileReference` is written in place of.
 */
export type PendingFileReference = {
    /**
     * The id of the file's `FileRecord`.
     */
    fileId: string,
    /**
     * Where the bytes are downloaded from, or undefined when no controller serves them.
     */
    url: string | undefined,
    /**
     * Writes the reference in place of the id, or null for a file that does not exist.
     */
    write: (reference: FileReference | null) => void
};

/**
 * Writes the `FileReference`s of the files kept in a file store that a response holds.
 */
export abstract class FileReferenceUtilities {
    /**
     * Writes the reference of each file in place of its id, read in one go.
     * @param pending - The ids a response holds, and where their references go.
     */
    static async resolveReferences(pending: PendingFileReference[]): Promise<void> {
        if (!pending.length) {
            return;
        }
        const fileService: FileServiceInterface = inject(ZIBRI_DI_TOKENS.FILE_SERVICE);
        const files: Map<string, FileRecord> = new Map(
            (await fileService.findFiles([...new Set(pending.map(p => p.fileId))])).map(f => [f.id, f])
        );
        const tenantService: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        const tenantId: string | undefined = tenantService.getActiveTenantId();
        await Promise.all(pending.map(async p => {
            const file: FileRecord | undefined = files.get(p.fileId);
            if (file == undefined) {
                p.write(null);
                return;
            }
            // with the tenant, so that the url works as a link, which carries no header
            const url: string | null = p.url == undefined
                ? null
                : tenantId == undefined ? p.url : await tenantService.resolveTenantUrl(p.url, tenantId);
            p.write({ name: file.name, mimeType: file.mimeType, size: file.size, url });
        }));
    }
}