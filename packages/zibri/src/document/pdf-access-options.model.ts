import { FsPath } from '../utilities/fs.utilities';

/**
 * What a pdf may read besides what its definition holds, such as an image given by its path or its URL.
 *
 * Applies with pdfmake 0.3. With pdfmake 0.2, a pdf reads every path its definition names, and fetches no URL.
 */
export type PdfAccessOptions = {
    /**
     * The folders a pdf may read files from. A path inside one of them is read, any other is refused.
     */
    allowedFolders: FsPath[],
    /**
     * Whether a pdf may fetch the URL, such as an image on `https://cdn.example.com`. No URL is fetched without it.
     */
    allowUrl?: (url: string) => boolean
};