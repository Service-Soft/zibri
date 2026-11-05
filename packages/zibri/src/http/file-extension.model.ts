import { FileMimeType, MimeType } from './mime-type.enum';

/**
 * All possible file extensions.
 */
export type FileExtension = NonNullable<(typeof mimeTypeToExtensions)[keyof typeof mimeTypeToExtensions]>[number];

/**
 * The file extensions for the given mime type.
 */
// eslint-disable-next-line typescript/typedef
export const mimeTypeToExtensions = {
    [MimeType.JSON]: ['.json'],
    [MimeType.HTML]: ['.html', '.htm'],
    [MimeType.PNG]: ['.png'],
    // eslint-disable-next-line cspell/spellchecker
    [MimeType.JPEG]: ['.jpeg', '.jpg', '.jpe', '.jfif'],
    [MimeType.ZIP]: ['.zip'],
    // eslint-disable-next-line cspell/spellchecker
    [MimeType.SVG]: ['.svg', '.svgz'],
    [MimeType.CSS]: ['.css'],
    [MimeType.TTF]: ['.ttf'],
    [MimeType.PDF]: ['.pdf'],
    [MimeType.CSV]: ['.csv'],
    [MimeType.XLSX]: ['.xlsx'],
    [MimeType.DOCX]: ['.docx'],
    [MimeType.TXT]: ['.txt'],
    [MimeType.XML]: ['.xml'],
    [MimeType.TEXT_XML]: ['.xml'],
    [MimeType.GZIP]: ['.gz', '.gzip'],
    [MimeType.TAR]: ['.tar'],
    [MimeType.WASM]: ['.wasm'],
    // eslint-disable-next-line cspell/spellchecker
    [MimeType.JSON_LD]: ['.jsonld', '.json-ld'],
    // eslint-disable-next-line cspell/spellchecker
    [MimeType.NDJSON]: ['.ndjson', '.jsonl'],
    [MimeType.PPTX]: ['.pptx'],
    [MimeType.JAVASCRIPT]: ['.js', '.cjs', '.mjs'],
    [MimeType.YAML]: ['.yaml', '.yml'],
    [MimeType.GIF]: ['.gif'],
    [MimeType.WEBP]: ['.webp'],
    [MimeType.ICO]: ['.ico', '.cur'],
    [MimeType.BMP]: ['.bmp', '.dib'],
    [MimeType.TIFF]: ['.tif', '.tiff'],
    [MimeType.AVIF]: ['.avif'],
    [MimeType.MP3]: ['.mp3'],
    [MimeType.WAV]: ['.wav'],
    [MimeType.OGG_AUDIO]: ['.ogg', '.oga'],
    [MimeType.WEBM_AUDIO]: ['.weba'],
    [MimeType.MP4]: ['.mp4', '.m4v'],
    [MimeType.WEBM_VIDEO]: ['.webm'],
    [MimeType.OGG_VIDEO]: ['.ogv'],
    [MimeType.OTF]: ['.otf'],
    [MimeType.WOFF]: ['.woff'],
    [MimeType.WOFF2]: ['.woff2']
} satisfies Record<FileMimeType, readonly Lowercase<`.${string}`>[] | undefined>;