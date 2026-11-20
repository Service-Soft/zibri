import { FsPath } from '../utilities/fs.utilities';
import { StagedFileCompression } from './staged-file-compression.type';
import { StagedFileEncryption } from './staged-file-encryption.model';

/**
 * A file staged on this instance's disk, on its way to or from a transport, and how it is stored.
 */
export type StagedFile = {
    /**
     * Where it is.
     */
    path: FsPath,
    /**
     * How it is compressed.
     */
    compression: StagedFileCompression,
    /**
     * What it is encrypted with, after it is compressed, or undefined for a file stored unencrypted.
     */
    encryption: StagedFileEncryption | undefined
};