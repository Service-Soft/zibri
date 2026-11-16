import { FsPath } from '../../utilities/fs.utilities';

/**
 * A chunk of an unencrypted resource, as a transport keeping files stores it.
 */
export type PlainChunk = {
    /**
     * The id of the chunk.
     */
    id: string,
    /**
     * The file of the chunk.
     */
    path: FsPath
};