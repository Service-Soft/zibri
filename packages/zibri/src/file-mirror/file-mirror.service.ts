import { createHash } from 'node:crypto';

import { type ZibriApplication } from '../application/application';
import { type PaginationResult } from '../data-source/models/pagination-result.model';
import { Repository } from '../data-source/repository/repository';
import { type RepositoryTransaction } from '../data-source/transaction/repository-transaction.type';
import { SpanningTransaction } from '../data-source/transaction/spanning-transaction.model';
import { TransactionUtilities } from '../data-source/transaction/transaction.utilities';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { InternalError } from '../error-handling/internal-error.model';
import { type OnAppInit } from '../global/on-app-init.interface';
import { $ts } from '../localization/translate.function';
import { type LoggerInterface } from '../logging/logger.interface';
import { type QueueDefinition } from '../queue/queue-definition.model';
import { QueueUtilities } from '../queue/queue.utilities';
import { type QueuedWorkOutcome } from '../queue/queued-work-outcome.model';
import { StorageUtilities } from '../storage/storage.utilities';
import { type TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { Ms } from '../utilities/ms';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';
import { NextcloudClient } from '../web-dav/nextcloud/nextcloud-client';
import { type NextcloudShare } from '../web-dav/nextcloud/nextcloud-share.model';
import { TenantWebDavConnection } from '../web-dav/tenant-web-dav-connection.model';
import { WebDavClient } from '../web-dav/web-dav-client';
import { WebDavConflictError } from '../web-dav/web-dav-conflict.error';
import { WebDavConnectionKind } from '../web-dav/web-dav-connection-kind.enum';
import { type WebDavDownload } from '../web-dav/web-dav-download.model';
import { type WebDavEntry } from '../web-dav/web-dav-entry.model';
import { WebDavPreconditionFailedError } from '../web-dav/web-dav-precondition-failed.error';
import { type WebDavPutOptions } from '../web-dav/web-dav-put-options.model';
import { FileMirrorRequest } from './file-mirror-request.model';
import { type FileMirrorServiceInterface } from './file-mirror-service.interface';
import { type FileMirrorShareLinkOptions } from './file-mirror-share-link-options.model';
import { FileMirrorShareLink } from './file-mirror-share-link.model';
import { type FileMirrorSource } from './file-mirror-source.model';
import { FileMirrorCronJob } from './file-mirror.cron-job';
import { type FileToMirror } from './file-to-mirror.model';
import { MirroredFileConflictResolution } from './mirrored-file-conflict-resolution.enum';
import { MirroredFileConflict } from './mirrored-file-conflict.enum';
import { MirroredFile } from './mirrored-file.model';

/**
 * How many attempts a queued file gets: the first retry after a minute, doubling, so the last one runs some six days
 * after it was queued, which a server down over a long weekend is back for.
 */
const MAX_ATTEMPTS: number = 14;

/**
 * How many queued files one pass reads, without their content.
 */
const PASS_SIZE: number = 100;

/**
 * How long one request to the server may take: a file of several megabytes goes out in one.
 */
const REQUEST_TIMEOUT_IN_MS: number = Ms.MINUTE;

/**
 * How many bytes a mirrored file holds at most, as `FileMirrorRequest` takes its content.
 */
const MAX_FILE_SIZE_IN_BYTES: number = 50 * 1024 * 1024;

/**
 * What the mirror is named as, in the errors of its paths and as its queue.
 */
const FILE_MIRROR_NAME: string = 'file mirror';

/**
 * A queued file as a pass reads it, without its content, which its run reads.
 */
type DueFileMirrorRequest = Pick<
    FileMirrorRequest,
    'id' | 'tenantId' | 'connectionId' | 'path' | 'contentHash' | 'sourceType' | 'sourceId' | 'createdAt' | 'attempts' | 'nextAttemptAt'
>;

/**
 * What a run leaves a mirrored file as: where it is, the version written last, and the conflict, if any.
 */
type MirrorOutcome = Required<
    Pick<MirroredFile, 'currentPath' | 'fileId' | 'etag' | 'contentHash' | 'mirroredAt' | 'conflict' | 'conflictAt'>
>;

/**
 * A file or a folder in the folder of the connection, with the id Nextcloud keeps it under.
 */
type FoundEntry = WebDavEntry<'fileId'>;

/**
 * A mirrored file that was written before, with the ETag written last.
 */
type WrittenMirroredFile = MirroredFile & {
    /**
     * The ETag written last.
     */
    etag: string
};

/**
 * What a file is written with.
 */
type FileWrite = {
    /**
     * What it holds.
     */
    content: Buffer,
    /**
     * The SHA-256 of what it holds, in hex.
     */
    contentHash: string,
    /**
     * The media type it is stored as.
     */
    contentType: string
};

/**
 * Default implementation of the file mirror service: each file is a row of `FileMirrorRequest`, written in the
 * transaction of the caller and run by `FileMirrorCronJob`. A file is created under `If-None-Match: *` with the folders
 * it is in, and written again under `If-Match` of the ETag written last, so that one somebody changed in the folder is
 * never replaced. Through a connection to a Nextcloud, a file that is no longer where it was is found again by its id.
 * The newest row of a file in conflict is kept, as what `resolveConflict` overwrites the file with.
 */
@Injectable({ register: 'onUse' })
export class FileMirrorService implements FileMirrorServiceInterface, OnAppInit {
    /**
     * When this process queued a file last, in milliseconds since the epoch.
     */
    private static lastQueuedAt: number = 0;

    // read when used rather than injected: the entities are declared only by an application that mirrors files
    private get requestRepository(): Repository<FileMirrorRequest> {
        return inject(repositoryTokenFor(FileMirrorRequest));
    }

    private get mirroredFileRepository(): Repository<MirroredFile> {
        return inject(repositoryTokenFor(MirroredFile));
    }

    private get connectionRepository(): Repository<TenantWebDavConnection> {
        return inject(repositoryTokenFor(TenantWebDavConnection));
    }

    private get shareLinkRepository(): Repository<FileMirrorShareLink> {
        return inject(repositoryTokenFor(FileMirrorShareLink));
    }

    private get tenantService(): TenantServiceInterface {
        return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    }

    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    /**
     * Registers the cron job writing the queued files, for an application that declares the entities of the mirror,
     * and validates that it declares all of them.
     * @param app - The application.
     */
    onAppInit(app: ZibriApplication): void {
        const declared: boolean = inject(ZIBRI_DI_TOKENS.DATA_SOURCE_SERVICE).getDataSources()
            .some(dataSource => dataSource.entities.includes(FileMirrorRequest) || dataSource.entities.includes(MirroredFile));
        if (!declared) {
            return;
        }
        validateEntitiesRegistered(FileMirrorService.name, app, FileMirrorRequest, MirroredFile, TenantWebDavConnection);
        if (!app.options.cronJobs.includes(FileMirrorCronJob)) {
            app.options.cronJobs.push(FileMirrorCronJob);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async mirrorFile(file: FileToMirror, transaction: RepositoryTransaction | undefined): Promise<void> {
        const tenantId: string | undefined = this.tenantService.getActiveTenantId();
        if (tenantId == undefined) {
            throw new InternalError(`A file is mirrored in the tenant it belongs to, and "${file.path}" was handed to the mirror in none.`);
        }
        // refused here, where the caller sees it, rather than by every attempt of a run
        const path: string = StorageUtilities.resolveKeySegments(FILE_MIRROR_NAME, file.path).join('/');
        await this.connectionRepository.findById(file.connectionId, { transaction });
        const content: Buffer = Buffer.from(file.content);
        // later than any queued before by this process, also within the same millisecond: the newest of a path is what
        // its folder is to hold, and the others are left to it
        FileMirrorService.lastQueuedAt = Math.max(Date.now(), FileMirrorService.lastQueuedAt + 1);
        await this.requestRepository.create({
            createdAt: new Date(FileMirrorService.lastQueuedAt),
            tenantId,
            connectionId: file.connectionId,
            path,
            contentType: file.contentType,
            content,
            contentHash: FileMirrorService.resolveHash(content),
            sourceType: file.source.type,
            sourceId: file.source.id
        }, { transaction });
        if (transaction == undefined) {
            await this.wakeUp();
            return;
        }
        transaction.afterCommit(async () => await this.wakeUp());
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async uploadDueFiles(): Promise<boolean> {
        return await QueueUtilities.poll(this.resolveQueue());
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findMirroredFiles(source: FileMirrorSource): Promise<MirroredFile[]> {
        return await this.mirroredFileRepository.findAll({
            where: { sourceType: source.type, sourceId: source.id },
            order: { path: 'ASC' },
            limit: 'all'
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findConflicts(page: number, limit: number): Promise<PaginationResult<MirroredFile>> {
        return await this.mirroredFileRepository.findAllPaginated(page, limit, {
            where: { conflict: { notOneOf: [null] } },
            order: { conflictAt: 'DESC', id: 'ASC' }
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveConflict(mirroredFileId: string, resolution: MirroredFileConflictResolution): Promise<void> {
        const record: MirroredFile = await this.mirroredFileRepository.findById(mirroredFileId);
        if (record.conflict == undefined) {
            throw new BadRequestError(
                $ts`The mirrored file "${record.path}" needs to be in conflict to resolve one, and holds what was mirrored last.`
            );
        }
        switch (resolution) {
            case MirroredFileConflictResolution.OVERWRITE: {
                await this.overwriteFile(record);
                return;
            }
            case MirroredFileConflictResolution.STOP_MIRRORING: {
                await this.stopMirroring(record);
                return;
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveShareLink(options: FileMirrorShareLinkOptions): Promise<FileMirrorShareLink> {
        const path: string = FileMirrorService.resolveSharePath(options.path);
        const [connection, client] = await this.resolveNextcloud(options.connectionId);
        const stored: FileMirrorShareLink | undefined = await this.shareLinkRepository
            .findOne({ where: { connectionId: connection.id, path }, required: false });
        // the link of before while Nextcloud has it: somebody may have deleted it there, or it expired
        if (stored != undefined && await client.findShare(stored.shareId) != undefined) {
            return stored;
        }
        const mirrored: MirroredFile | undefined = await this.mirroredFileRepository
            .findOne({ where: { connectionId: connection.id, path }, required: false });
        const share: NextcloudShare = await client.createShare({
            type: 'link',
            path: mirrored?.currentPath ?? path,
            password: options.password,
            expiresOn: options.expiresOn
        });
        if (share.url == undefined) {
            throw new InternalError(`Nextcloud answered the share link of "${path}" without its url.`);
        }
        const data: Pick<FileMirrorShareLink, 'shareId' | 'url' | 'expiresOn'> = {
            shareId: share.id,
            url: share.url,
            expiresOn: share.expiresOn ?? null
        };
        return stored != undefined
            ? await this.shareLinkRepository.updateById(stored.id, data)
            : await this.shareLinkRepository.create({ connectionId: connection.id, path, ...data });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async revokeShareLink(connectionId: string, path: string): Promise<void> {
        const sharePath: string = FileMirrorService.resolveSharePath(path);
        const [connection, client] = await this.resolveNextcloud(connectionId);
        const stored: FileMirrorShareLink | undefined = await this.shareLinkRepository
            .findOne({ where: { connectionId: connection.id, path: sharePath }, required: false });
        if (stored == undefined) {
            return;
        }
        // the share first: a link whose row is gone while its share is not would open for good, with nothing left to
        // revoke it by
        await client.deleteShare(stored.shareId);
        await this.shareLinkRepository.deleteById(stored.id);
    }

    /**
     * Resolves the path of a share link, as the application or a request names it.
     * @param path - The path, relative to the url of the connection.
     * @returns Its segments, joined by `/`.
     * @throws {BadRequestError} When it has an empty segment, `.` or `..`.
     */
    private static resolveSharePath(path: string): string {
        try {
            return StorageUtilities.resolveKeySegments(FILE_MIRROR_NAME, path).join('/');
        }
        catch (error) {
            throw new BadRequestError(
                $ts`The path of a share link needs to be segments separated by /, none of them empty, . or .., and is "${path}".`,
                { cause: error }
            );
        }
    }

    /**
     * Resolves a connection of the tenant to a Nextcloud, and its client.
     * @param connectionId - The id of the connection.
     * @returns The connection and its client.
     * @throws NotFoundError when the tenant has no connection of the id.
     * @throws {BadRequestError} When the connection is not to a Nextcloud.
     */
    private async resolveNextcloud(connectionId: string): Promise<[TenantWebDavConnection, NextcloudClient]> {
        const connection: TenantWebDavConnection = await this.connectionRepository.findById(connectionId);
        if (connection.kind !== WebDavConnectionKind.NEXTCLOUD) {
            throw new BadRequestError(
                $ts`A share link needs a connection to a Nextcloud, and the WebDAV connection "${connection.name}" is to another server.`
            );
        }
        return [connection, NextcloudClient.createForTenant(connection, { timeoutInMs: REQUEST_TIMEOUT_IN_MS })];
    }

    /**
     * Writes the newest version mirrored of a file in conflict over what is in the folder, without a condition, and
     * records it as written. Where the file is: where Nextcloud says its id is now, or where it was mirrored to when it
     * is missing, or where it was found changed.
     * @param record - The mirrored file.
     * @throws {BadRequestError} When no version of it is kept.
     */
    private async overwriteFile(record: MirroredFile): Promise<void> {
        // the newest of the path, whether held for the conflict, queued since or failed: what the folder is to hold
        const [latest]: (FileMirrorRequest | undefined)[] = await this.requestRepository.findAll({
            where: { connectionId: record.connectionId, path: record.path },
            order: { createdAt: 'DESC', id: 'DESC' },
            limit: 1
        });
        if (latest == undefined) {
            throw new BadRequestError(
                $ts`The mirrored file "${record.path}" needs to be mirrored again to be overwritten, as no version of it is kept.`
            );
        }
        const connection: TenantWebDavConnection = await this.connectionRepository.findById(record.connectionId);
        const client: WebDavClient = this.createClient(connection);
        const target: Pick<FoundEntry, 'path' | 'properties'> = await this.resolveOverwriteTarget(client, record);
        const file: FileWrite = { content: latest.content, contentHash: latest.contentHash, contentType: latest.contentType };
        const etag: string | undefined = await this.putCreatingFolders(
            client,
            target.path,
            file,
            { contentType: file.contentType, overwrite: true }
        );
        const outcome: MirrorOutcome = await this.resolveWrittenAt(client, target.path, etag, file, target.properties.fileId);
        await this.mirroredFileRepository.updateById(record.id, { sourceType: latest.sourceType, sourceId: latest.sourceId, ...outcome });
        // the versions it replaces, and itself
        await this.requestRepository.deleteAll({
            connectionId: record.connectionId,
            path: record.path,
            createdAt: { before: latest.createdAt }
        });
        await this.requestRepository.deleteAll({ id: latest.id });
    }

    /**
     * Resolves where a file in conflict is overwritten.
     * @param client - The client of the folder.
     * @param record - The mirrored file.
     * @returns The path, and the id Nextcloud keeps the file there under, when it is the file mirrored.
     */
    private async resolveOverwriteTarget(
        client: WebDavClient,
        record: MirroredFile
    ): Promise<Pick<FoundEntry, 'path' | 'properties'>> {
        // looked up again: somebody may have moved it since the conflict was found
        if (client instanceof NextcloudClient && record.fileId != undefined) {
            const found: FoundEntry | undefined = await client.findEntryByFileId(record.fileId, record.currentPath);
            if (found?.kind === 'file') {
                return found;
            }
        }
        // a file that is gone is put back where the application mirrors it to, not where somebody last had it
        const path: string = record.conflict === MirroredFileConflict.MISSING ? record.path : record.currentPath;
        return { path, properties: { fileId: undefined } };
    }

    /**
     * Forgets a mirrored file and the versions queued of it, in one transaction, and leaves the folder as it is.
     * @param record - The mirrored file.
     */
    private async stopMirroring(record: MirroredFile): Promise<void> {
        // spanning, as the queued files may be kept in another data source than the mirrored ones
        await TransactionUtilities.runAndCommit(new SpanningTransaction(), async transaction => {
            await this.requestRepository.deleteAll({ connectionId: record.connectionId, path: record.path }, { transaction });
            await this.mirroredFileRepository.deleteById(record.id, { transaction });
        });
    }

    /**
     * Resolves the SHA-256 of content.
     * @param content - The content.
     * @returns The hash, in hex.
     */
    private static resolveHash(content: Buffer): string {
        return createHash('sha256').update(content)
            .digest('hex');
    }

    /**
     * Resolves the outcome of a file that was not written.
     * @param conflict - Why not.
     * @param currentPath - Where the file is now.
     * @param record - The mirrored file, or undefined for one that was never written.
     * @returns The outcome, with the version written last.
     */
    private static resolveConflictOutcome(
        conflict: MirroredFileConflict,
        currentPath: string,
        record: MirroredFile | undefined
    ): MirrorOutcome {
        return {
            currentPath,
            fileId: record?.fileId ?? null,
            etag: record?.etag ?? null,
            contentHash: record?.contentHash ?? null,
            mirroredAt: record?.mirroredAt ?? null,
            conflict,
            conflictAt: new Date()
        };
    }

    /**
     * Wakes the cron job up, for a file queued.
     */
    private async wakeUp(): Promise<void> {
        await inject(ZIBRI_DI_TOKENS.WAKE_UP_SERVICE).wake(this.requestRepository.dataSource, FileMirrorCronJob.WAKE_UP_TOPIC);
    }

    /**
     * Resolves the queue of the files: which are due, how one is run, and what becomes of it after its attempt.
     * @returns The queue.
     */
    private resolveQueue(): QueueDefinition<DueFileMirrorRequest> {
        return {
            name: FILE_MIRROR_NAME,
            wakeUpTopic: FileMirrorCronJob.WAKE_UP_TOPIC,
            leaseInMs: Ms.MINUTE * 5,
            onCompletion: 'release',
            claimedPer: 'item',
            // a run waits on the server most of its time, and holds the content of its file in memory
            maxConcurrentPerInstance: 5,
            firstRetryDelayInMs: Ms.MINUTE,
            findDue: async () => await this.requestRepository.findAll({
                // a file that spent its attempts stays as the record of what failed, until a later one of the same path
                // is written. One held for a conflict waits for the conflict to be resolved
                where: [
                    { attempts: { lesserThan: MAX_ATTEMPTS }, nextAttemptAt: null, heldForConflict: false },
                    { attempts: { lesserThan: MAX_ATTEMPTS }, nextAttemptAt: { before: new Date() }, heldForConflict: false }
                ],
                select: {
                    id: true,
                    tenantId: true,
                    connectionId: true,
                    path: true,
                    contentHash: true,
                    sourceType: true,
                    sourceId: true,
                    createdAt: true,
                    attempts: true,
                    nextAttemptAt: true
                },
                order: { createdAt: 'ASC', id: 'ASC' },
                limit: PASS_SIZE,
                // one queue for every tenant, which each file runs in
                acrossTenants: true
            }),
            // claimed per file rather than per row, so that two versions of one file are never written at once
            findRunId: request => `${request.connectionId}:${createHash('sha256').update(request.path)
                .digest('hex')}`,
            findMaxAttempts: () => MAX_ATTEMPTS,
            run: async request => await this.tenantService.runAs(request.tenantId, async () => await this.runRequest(request)),
            record: async (request, outcome) => await this.recordAttempt(request, outcome)
        };
    }

    /**
     * Writes a queued file into its folder, in its tenant, unless a later one of the same path is queued, and deletes
     * the ones of the path queued before it.
     * @param request - The queued file.
     */
    private async runRequest(request: DueFileMirrorRequest): Promise<void> {
        // the later one holds what the folder is to hold, and is run on its own
        const superseded: boolean = await this.requestRepository.exists({
            where: { connectionId: request.connectionId, path: request.path, createdAt: { after: request.createdAt } }
        });
        if (superseded) {
            return;
        }
        const record: MirroredFile | undefined = await this.mirroredFileRepository.findOne({
            where: { connectionId: request.connectionId, path: request.path },
            required: false
        });
        // the same content as written last is nothing to write, whatever became of the file in the folder since. A file
        // in conflict keeps it as what overwriting the file writes
        let inConflict: boolean = record?.conflict != undefined;
        if (record?.contentHash !== request.contentHash) {
            const queued: Pick<FileMirrorRequest, 'content' | 'contentType'> = await this.requestRepository
                .findById(request.id, { select: { content: true, contentType: true } });
            const connection: TenantWebDavConnection = await this.connectionRepository.findById(request.connectionId);
            const outcome: MirrorOutcome = await this.writeFile(
                this.createClient(connection),
                request.path,
                { content: queued.content, contentHash: request.contentHash, contentType: queued.contentType },
                record
            );
            const data: Pick<MirroredFile, 'sourceType' | 'sourceId'> & MirrorOutcome = {
                sourceType: request.sourceType,
                sourceId: request.sourceId,
                ...outcome
            };
            if (record == undefined) {
                await this.mirroredFileRepository.create({ connectionId: request.connectionId, path: request.path, ...data });
            }
            else {
                await this.mirroredFileRepository.updateById(record.id, data);
            }
            inConflict = outcome.conflict != undefined;
            if (outcome.conflict != undefined) {
                this.logConflict(connection, request.path, outcome);
            }
        }
        if (inConflict) {
            // by a filter rather than by id, for the reason recordAttempt gives
            await this.requestRepository.updateAll({ id: request.id }, { heldForConflict: true });
        }
        // the ones queued before are written or held by this one, those that spent their attempts among them
        await this.requestRepository.deleteAll({
            connectionId: request.connectionId,
            path: request.path,
            createdAt: { before: request.createdAt }
        });
    }

    /**
     * Records how an attempt at a queued file ended: deleted once it succeeded, retried later or kept as failed
     * otherwise.
     * @param request - The queued file.
     * @param outcome - How its attempt ended.
     */
    private async recordAttempt(request: DueFileMirrorRequest, outcome: QueuedWorkOutcome): Promise<void> {
        // by a filter rather than by id, which throws for a row a run of a later one deleted meanwhile
        if (outcome.kind === 'succeeded') {
            // one held for a conflict stays until the conflict is resolved
            await this.requestRepository.deleteAll({ id: request.id, heldForConflict: false }, { acrossTenants: true });
            return;
        }
        await this.requestRepository.updateAll(
            { id: request.id },
            { attempts: outcome.attempts, nextAttemptAt: outcome.nextAttemptAt, error: outcome.error },
            { acrossTenants: true }
        );
    }

    /**
     * Creates the client of a connection, of its kind, its host checked as for a connection of a tenant.
     * @param connection - The connection.
     * @returns The client.
     */
    private createClient(connection: TenantWebDavConnection): WebDavClient {
        switch (connection.kind) {
            case WebDavConnectionKind.WEB_DAV: {
                return WebDavClient.createForTenant(connection, { timeoutInMs: REQUEST_TIMEOUT_IN_MS });
            }
            case WebDavConnectionKind.NEXTCLOUD: {
                return NextcloudClient.createForTenant(connection, { timeoutInMs: REQUEST_TIMEOUT_IN_MS });
            }
        }
    }

    /**
     * Writes a file into its folder: creates it where it was never written, and writes it under the ETag written last
     * otherwise.
     * @param client - The client of the folder.
     * @param path - Where the application mirrors the file to.
     * @param file - What the file holds.
     * @param record - The mirrored file, or undefined for one never queued before.
     * @returns What the file is left as.
     */
    private async writeFile(
        client: WebDavClient,
        path: string,
        file: FileWrite,
        record: MirroredFile | undefined
    ): Promise<MirrorOutcome> {
        return record?.etag == undefined
            ? await this.createFile(client, path, file)
            : await this.updateFile(client, { ...record, etag: record.etag }, file);
    }

    /**
     * Creates a file where none is, with the folders it is in.
     * @param client - The client of the folder.
     * @param path - Where the file goes.
     * @param file - What the file holds.
     * @returns What the file is left as: written, or a conflict for another file where it goes.
     */
    private async createFile(client: WebDavClient, path: string, file: FileWrite): Promise<MirrorOutcome> {
        const condition: WebDavPutOptions = { contentType: file.contentType, ifNoneMatch: '*' };
        let etag: string | undefined;
        try {
            etag = await this.putCreatingFolders(client, path, file, condition);
        }
        catch (error) {
            if (!(error instanceof WebDavPreconditionFailedError)) {
                throw error;
            }
            // a file is where this one goes: one of an earlier attempt whose row was never written holds the same
            const found: FoundEntry | undefined = await this.findEntry(client, path);
            return found == undefined || !await this.holds(client, found, file)
                ? FileMirrorService.resolveConflictOutcome(MirroredFileConflict.CHANGED, path, undefined)
                : this.resolveWritten(found, found.etag, file);
        }
        return await this.resolveWrittenAt(client, path, etag, file, undefined);
    }

    /**
     * Writes a file again under the ETag written last, wherever it is now.
     * @param client - The client of the folder.
     * @param record - The mirrored file, with the ETag written last.
     * @param file - What the file holds.
     * @returns What the file is left as: written, or a conflict for a file changed or gone.
     */
    private async updateFile(client: WebDavClient, record: WrittenMirroredFile, file: FileWrite): Promise<MirrorOutcome> {
        const condition: WebDavPutOptions = { contentType: file.contentType, ifMatch: record.etag };
        // judged by what is there below, as a put refused under its condition is
        const changed: boolean = client instanceof NextcloudClient && await this.isChangedSinceMirrored(client, record);
        if (!changed) {
            try {
                const etag: string | undefined = await this.putFile(client, record.currentPath, file, condition);
                return await this.resolveWrittenAt(client, record.currentPath, etag, file, record.fileId ?? undefined);
            }
            catch (error) {
                // a 409 for a folder that is gone, which a server may answer before it reads the condition
                if (!(error instanceof WebDavPreconditionFailedError) && !(error instanceof WebDavConflictError)) {
                    throw error;
                }
            }
        }
        const found: FoundEntry | undefined = await this.findEntry(client, record.currentPath);
        if (found != undefined) {
            // an earlier attempt that wrote it, and whose row was never written, left the same
            return await this.holds(client, found, file)
                ? this.resolveWritten(found, found.etag, file)
                : FileMirrorService.resolveConflictOutcome(MirroredFileConflict.CHANGED, record.currentPath, record);
        }
        // nothing where it was: moved, renamed or deleted, which only Nextcloud tells apart, by the id of the file.
        // Never written again where it was, which would leave a second copy beside the one somebody moved
        return !(client instanceof NextcloudClient) || record.fileId == undefined
            ? FileMirrorService.resolveConflictOutcome(MirroredFileConflict.MISSING, record.currentPath, record)
            : await this.updateMovedFile(client, record, record.fileId, file);
    }

    /**
     * Writes a file that is no longer where it was again where Nextcloud says its id is now, under its ETag there.
     * @param client - The client of the folder, of Nextcloud.
     * @param record - The mirrored file, with the ETag written last.
     * @param fileId - The id Nextcloud keeps the file under.
     * @param file - What the file holds.
     * @returns What the file is left as: written, or a conflict for a file changed or gone.
     */
    private async updateMovedFile(
        client: NextcloudClient,
        record: WrittenMirroredFile,
        fileId: string,
        file: FileWrite
    ): Promise<MirrorOutcome> {
        const moved: FoundEntry | undefined = await client.findEntryByFileId(fileId, record.currentPath);
        if (moved == undefined) {
            return FileMirrorService.resolveConflictOutcome(MirroredFileConflict.MISSING, record.currentPath, record);
        }
        // a server may name another ETag for a file it moved: one holding what was written last is unchanged all the same.
        // And Nextcloud names the same one for a change in the second of the write before, so its ETag alone says nothing
        const unchanged: boolean = (
            moved.etag === record.etag
            && !await this.isChangedSinceMirrored(client, { ...record, currentPath: moved.path })
        ) || (
            moved.etag != undefined
            && record.contentHash != undefined
            && await this.holdsHash(client, moved, record.contentHash, undefined)
        );
        if (!unchanged || moved.etag == undefined) {
            return await this.holds(client, moved, file)
                ? this.resolveWritten(moved, moved.etag, file)
                : FileMirrorService.resolveConflictOutcome(MirroredFileConflict.CHANGED, moved.path, record);
        }
        try {
            const etag: string | undefined = await this.putFile(
                client,
                moved.path,
                file,
                { contentType: file.contentType, ifMatch: moved.etag }
            );
            return await this.resolveWrittenAt(client, moved.path, etag, file, fileId);
        }
        catch (error) {
            // changed between the search and the put
            if (!(error instanceof WebDavPreconditionFailedError)) {
                throw error;
            }
            return FileMirrorService.resolveConflictOutcome(MirroredFileConflict.CHANGED, moved.path, record);
        }
    }

    /**
     * Writes a file, creating the folders it is in when the server answers that they are missing.
     * @param client - The client of the folder.
     * @param path - The path of the file.
     * @param file - What it holds.
     * @param condition - What it is written under.
     * @returns The ETag the server answered with, if any.
     */
    private async putCreatingFolders(
        client: WebDavClient,
        path: string,
        file: FileWrite,
        condition: WebDavPutOptions
    ): Promise<string | undefined> {
        try {
            return await this.putFile(client, path, file, condition);
        }
        catch (error) {
            // put first, and the folders created only when missing: a file usually goes into a folder that exists
            const parent: string = path.split('/').slice(0, -1)
                .join('/');
            if (!(error instanceof WebDavConflictError) || parent === '') {
                throw error;
            }
            await client.createFolder(parent);
            return await this.putFile(client, path, file, condition);
        }
    }

    /**
     * Writes a file, on Nextcloud with the checksum of what it holds, which {@link isChangedSinceMirrored} reads.
     * @param client - The client of the folder.
     * @param path - The path of the file.
     * @param file - What it holds.
     * @param condition - What it is written under.
     * @returns The ETag the server answered with, if any.
     */
    private async putFile(client: WebDavClient, path: string, file: FileWrite, condition: WebDavPutOptions): Promise<string | undefined> {
        return client instanceof NextcloudClient
            ? await client.putWithChecksum(path, file.content, condition, file.contentHash)
            : await client.put(path, file.content, condition);
    }

    /**
     * Whether somebody changed a file on Nextcloud since it was mirrored, by the checksum the mirror writes it with:
     * Nextcloud names the same ETag for a change in the second of the write before, which no `If-Match` refuses, and
     * a change names its own checksum, or leaves the file without one.
     * @param client - The client of the folder, of Nextcloud.
     * @param record - The mirrored file.
     * @returns True when the file holds another checksum, none, or is not where it was.
     */
    private async isChangedSinceMirrored(client: NextcloudClient, record: MirroredFile): Promise<boolean> {
        const entry: WebDavEntry<'checksums'> | undefined = await client
            .findEntry(record.currentPath, { checksums: NextcloudClient.CHECKSUMS_PROPERTY });
        return entry == undefined
            || record.contentHash == undefined
            || !NextcloudClient.holdsChecksum(entry.properties.checksums, record.contentHash);
    }

    /**
     * Finds the file or the folder at a path, with the id Nextcloud keeps it under.
     * @param client - The client of the folder.
     * @param path - The path.
     * @returns It, or undefined when nothing is there.
     */
    private async findEntry(client: WebDavClient, path: string): Promise<FoundEntry | undefined> {
        if (client instanceof NextcloudClient) {
            return await client.findEntry(path, { fileId: NextcloudClient.FILE_ID_PROPERTY });
        }
        const entry: WebDavEntry | undefined = await client.findEntry(path);
        return entry == undefined ? undefined : { ...entry, properties: { fileId: undefined } };
    }

    /**
     * Whether a file in the folder holds what is mirrored, byte for byte.
     * @param client - The client of the folder.
     * @param entry - The file.
     * @param file - What is mirrored.
     * @returns Whether it does.
     */
    private async holds(client: WebDavClient, entry: FoundEntry, file: FileWrite): Promise<boolean> {
        return await this.holdsHash(client, entry, file.contentHash, file.content.length);
    }

    /**
     * Whether a file in the folder holds content of a hash.
     * @param client - The client of the folder.
     * @param entry - The file.
     * @param contentHash - The SHA-256 of the content, in hex.
     * @param size - How many bytes the content has, or undefined when unknown.
     * @returns Whether it does.
     */
    private async holdsHash(client: WebDavClient, entry: FoundEntry, contentHash: string, size: number | undefined): Promise<boolean> {
        // by its size first, which the listing names, so that a file of another size, or larger than a mirrored file
        // can be, is not read
        if (
            entry.kind !== 'file'
            || entry.size == undefined
            || entry.size > MAX_FILE_SIZE_IN_BYTES
            || (size != undefined && entry.size !== size)
        ) {
            return false;
        }
        const download: WebDavDownload = await client.get(entry.path, `${entry.size}b`);
        return FileMirrorService.resolveHash(Buffer.concat(await download.content.toArray())) === contentHash;
    }

    /**
     * Resolves the outcome of a file written, reading its ETag and the id Nextcloud keeps it under where the answer
     * to the put names neither.
     * @param client - The client of the folder.
     * @param path - Where the file was written.
     * @param etag - The ETag the put answered with, if any.
     * @param file - What the file holds.
     * @param fileId - The id Nextcloud keeps the file under, when known.
     * @returns The outcome.
     */
    private async resolveWrittenAt(
        client: WebDavClient,
        path: string,
        etag: string | undefined,
        file: FileWrite,
        fileId: string | undefined
    ): Promise<MirrorOutcome> {
        // Apache, and a server changing what it stores, name no ETag in their answer, and a put names no id
        const needsEntry: boolean = etag == undefined || (client instanceof NextcloudClient && fileId == undefined);
        const found: FoundEntry | undefined = needsEntry ? await this.findEntry(client, path) : undefined;
        return this.resolveWritten({ path, properties: { fileId: fileId ?? found?.properties.fileId } }, etag ?? found?.etag, file);
    }

    /**
     * Resolves the outcome of a file written.
     * @param entry - Where it is, and the id Nextcloud keeps it under.
     * @param etag - The ETag of what was written.
     * @param file - What the file holds.
     * @returns The outcome.
     * @throws {InternalError} When the server names no ETag of the file, which a file is written again under.
     */
    private resolveWritten(entry: Pick<FoundEntry, 'path' | 'properties'>, etag: string | undefined, file: FileWrite): MirrorOutcome {
        if (etag == undefined) {
            throw new InternalError(
                `The WebDAV server names no ETag of "${entry.path}", which a mirrored file needs to be written again under.`
            );
        }
        return {
            currentPath: entry.path,
            fileId: entry.properties.fileId ?? null,
            etag,
            contentHash: file.contentHash,
            mirroredAt: new Date(),
            conflict: null,
            conflictAt: null
        };
    }

    /**
     * Logs a file that was not written for a conflict.
     * @param connection - The connection of its folder.
     * @param path - Where the application mirrors it to.
     * @param outcome - What it is left as.
     */
    private logConflict(connection: TenantWebDavConnection, path: string, outcome: MirrorOutcome): void {
        const where: string = outcome.currentPath === path ? `"${path}"` : `"${path}", now at "${outcome.currentPath}",`;
        const why: string = outcome.conflict === MirroredFileConflict.MISSING
            ? 'is no longer in the folder'
            : 'was changed in the folder since it was mirrored, or is another file';
        this.logger.warn(
            `The file ${where} of the WebDAV connection "${connection.name}" ${why}, so what was mirrored last is not written into it`
        );
    }
}