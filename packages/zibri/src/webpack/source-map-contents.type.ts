/**
 * What the map beside the bundle carries.
 *
 * Either way a stack trace read through it names the source file and line of every frame. With
 * `'with-sources'` the map also holds the sources themselves, so an editor opens the source of a
 * frame from the map alone. With `'file-and-line'` it holds the mappings only, at a third of the
 * weight, which is what a deployment carries.
 */
export type SourceMapContents = 'with-sources' | 'file-and-line';