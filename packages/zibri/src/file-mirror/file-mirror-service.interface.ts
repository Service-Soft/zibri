import { type PaginationResult } from '../data-source/models/pagination-result.model';
import { type RepositoryTransaction } from '../data-source/transaction/repository-transaction.type';
import { type FileMirrorShareLinkOptions } from './file-mirror-share-link-options.model';
import { type FileMirrorShareLink } from './file-mirror-share-link.model';
import { type FileMirrorSource } from './file-mirror-source.model';
import { type FileToMirror } from './file-to-mirror.model';
import { type MirroredFileConflictResolution } from './mirrored-file-conflict-resolution.enum';
import { type MirroredFile } from './mirrored-file.model';

/**
 * Interface for the service mirroring files of the application into folders of WebDAV servers, such as the pdf of an
 * invoice into the folder of its customer on Nextcloud. It writes, and never deletes: a file somebody changed in the
 * folder is left as it is, and the conflict recorded until somebody resolves it. Called in the tenant the files belong
 * to.
 */
export interface FileMirrorServiceInterface {
    /**
     * Queues a file to mirror in a transaction, which is written into its folder once the transaction is committed,
     * and again after a failed attempt, such as while the server cannot be reached. A file holding what was mirrored
     * last is not written again.
     * @param file - The file, and where it goes.
     * @param transaction - The transaction the file is queued in, which a write rolled back takes with it, or
     * undefined to queue it at once.
     * @throws {NotFoundError} When the tenant has no connection of the id.
     * @throws {InternalError} When the path has an empty segment, `.` or `..`, or no tenant is active.
     */
    mirrorFile: (file: FileToMirror, transaction: RepositoryTransaction | undefined) => Promise<void>,
    /**
     * Writes the queued files that are due into their folders, as `FileMirrorCronJob` does.
     * @returns Whether any was due.
     */
    uploadDueFiles: () => Promise<boolean>,
    /**
     * Finds the mirrored files of a row, one per connection and path.
     * @param source - The row.
     * @returns The files.
     */
    findMirroredFiles: (source: FileMirrorSource) => Promise<MirroredFile[]>,
    /**
     * Finds a page of the mirrored files of the tenant that are not written as last mirrored, for a conflict.
     * @param page - The page, counting from 1.
     * @param limit - How many files a page holds.
     * @returns The files of the page, the latest conflict first, and how many there are.
     */
    findConflicts: (page: number, limit: number) => Promise<PaginationResult<MirroredFile>>,
    /**
     * Resolves the conflict of a mirrored file. `OVERWRITE` writes the last version mirrored over what is in the
     * folder, without a condition: where the file is now, or where it was mirrored to when it is gone, and records it
     * as written. `STOP_MIRRORING` forgets the file and the versions queued of it, and leaves the folder as it is: a
     * later version mirrored to its path is a new file, written only where nothing is, and in conflict otherwise.
     * @param mirroredFileId - The id of the mirrored file.
     * @param resolution - How the conflict is resolved.
     * @throws {NotFoundError} When the tenant has no mirrored file of the id.
     * @throws {BadRequestError} When the file has no conflict, or the version to overwrite with is no longer kept.
     * @throws {HttpClientError} When the server refuses the file, or cannot be reached, which leaves the conflict.
     */
    resolveConflict: (mirroredFileId: string, resolution: MirroredFileConflictResolution) => Promise<void>,
    /**
     * Resolves a link Nextcloud shares a mirrored file or folder by, to read: the one created for the path before,
     * while Nextcloud still has it, or a new one.
     * @param options - The path, and the password and the expiry of a link created.
     * @returns The link.
     * @throws {NotFoundError} When the tenant has no connection of the id.
     * @throws {BadRequestError} When the connection is not to a Nextcloud, or the path has an empty segment, `.` or
     * `..`.
     * @throws {WebDavNotFoundError} When there is nothing at the path.
     * @throws {HttpClientError} When Nextcloud refuses the link, such as for a password its policy refuses, or cannot
     * be reached.
     */
    resolveShareLink: (options: FileMirrorShareLinkOptions) => Promise<FileMirrorShareLink>,
    /**
     * Revokes the link of a path: deletes its share in Nextcloud, then the stored link. A share somebody deleted in
     * Nextcloud already counts as deleted, and a path without a link is left as it is. The next link asked for the
     * path is a new one.
     * @param connectionId - The id of the `TenantWebDavConnection` of the active tenant, of the kind `NEXTCLOUD`.
     * @param path - The path the link was asked for, relative to the url of the connection.
     * @throws {NotFoundError} When the tenant has no connection of the id.
     * @throws {BadRequestError} When the connection is not to a Nextcloud, or the path has an empty segment, `.` or
     * `..`.
     * @throws {HttpClientError} When Nextcloud refuses, or cannot be reached, which keeps the link.
     */
    revokeShareLink: (connectionId: string, path: string) => Promise<void>
}
