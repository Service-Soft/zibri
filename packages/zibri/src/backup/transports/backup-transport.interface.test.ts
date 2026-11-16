/* eslint-disable typescript/no-deprecated -- the members of v1, which 3.x keeps until 4.0 */
import { Readable } from 'node:stream';

import { describe, expect, it } from '@jest/globals';

import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { BackupTransportInterface, BackupTransportSupporting, BackupTransportVersion, isBackupTransport } from './backup-transport.interface';
import { BaseFsBackupTransport } from './base-fs.backup-transport';
import { FsBackupTransport } from './fs.backup-transport';
import { InMemoryBackupTransport } from '../../__testing__/backup/in-memory.backup-transport';
import { testFileFolder } from '../../__testing__/constants';
import { Newable } from '../../types/newable.type';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';

/**
 * A transport of v1, as an application of 3.0 wrote it.
 */
class V1Transport implements BackupTransportInterface {
    readonly name: string = 'v1';

    resolveBackups(): string[] {
        return [];
    }

    storeData(): void {
        // keeps nothing
    }

    storeMetadata(): void {
        // keeps nothing
    }

    retrieveData(): Readable {
        return Readable.from([]);
    }

    deleteData(): void {
        // keeps nothing
    }

    deleteMetadata(): void {
        // keeps nothing
    }
}

/**
 * A transport of v2 alone.
 */
class V2Transport implements BackupTransportInterface<'v2'> {
    readonly name: string = 'v2';
    readonly versions: readonly 'v2'[] = ['v2'];

    async openSession(): Promise<BackupTransportSessionInterface> {
        return await new InMemoryBackupTransport(this.name).openSession();
    }
}

/**
 * A transport of v2 alone that defines a member of v1 by mistake.
 */
class V2TransportWithStoreData implements BackupTransportInterface<'v2'> {
    readonly name: string = 'v2-with-store-data';
    readonly versions: readonly 'v2'[] = ['v2'];

    async openSession(): Promise<BackupTransportSessionInterface> {
        return await new InMemoryBackupTransport(this.name).openSession();
    }

    // @ts-expect-error a transport of v2 alone cannot define a member of v1
    storeData(): void {
        // keeps nothing
    }
}

/**
 * A transport of v1 that leaves out a member of v1.
 */
// @ts-expect-error a transport of v1 implements every member of v1
class V1TransportWithoutDeleteMetadata implements BackupTransportInterface {
    readonly name: string = 'v1-without-delete-metadata';

    resolveBackups(): string[] {
        return [];
    }

    storeData(): void {
        // keeps nothing
    }

    storeMetadata(): void {
        // keeps nothing
    }

    retrieveData(): Readable {
        return Readable.from([]);
    }

    deleteData(): void {
        // keeps nothing
    }
}

/**
 * A transport of v2 that leaves out the versions it supports.
 */
// @ts-expect-error a transport of v2 names the versions it supports
class V2TransportWithoutVersions implements BackupTransportInterface<'v2'> {
    readonly name: string = 'v2-without-versions';

    async openSession(): Promise<BackupTransportSessionInterface> {
        return await new InMemoryBackupTransport(this.name).openSession();
    }
}

const folder: FsPath = FsUtilities.getPath(testFileFolder, 'backup-transport-interface');

/**
 * A transport built on a deprecated shipped one, as an application of 3.0 wrote it.
 */
class NasBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'nas';
    protected override readonly backupBasePath: FsPath = folder;
}

describe('BackupTransportInterface', () => {
    it('takes a transport of either version, and one supporting both, where any transport goes', () => {
        const transports: Newable<BackupTransportSupporting>[] = [V1Transport, V2Transport, NasBackupTransport];
        const both: BackupTransportInterface<BackupTransportVersion> = new FsBackupTransport('both', folder);
        // a shipped transport is one of v1 as well, as 3.0 typed it
        const asInThree: BackupTransportInterface = new NasBackupTransport();

        expect(transports).toHaveLength(3);
        expect(both.versions).toEqual(['v1', 'v2']);
        expect(asInThree.name).toBe('nas');
        expect([V2TransportWithStoreData, V1TransportWithoutDeleteMetadata, V2TransportWithoutVersions]).toHaveLength(3);
    });

    it('tells a transport of v1 by its members, as 3.0 did, and one of v2 by its versions and sessions', () => {
        expect(isBackupTransport(new V1Transport())).toBe(true);
        expect(isBackupTransport(new V1Transport(), 'v2')).toBe(false);
        expect(isBackupTransport(new V2Transport())).toBe(false);
        expect(isBackupTransport(new V2Transport(), 'v2')).toBe(true);
        expect(isBackupTransport(new FsBackupTransport('both', folder))).toBe(true);
        expect(isBackupTransport(new FsBackupTransport('both', folder), 'v2')).toBe(true);
        expect(isBackupTransport({ name: 'sessions alone', openSession: async () => await Promise.reject(new Error('unused')) }, 'v2'))
            .toBe(false);
        expect(isBackupTransport(undefined)).toBe(false);
    });
});