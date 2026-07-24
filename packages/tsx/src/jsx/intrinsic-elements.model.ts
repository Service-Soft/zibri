import { AnchorAttributes,
    AreaAttributes,
    BaseAttributes,
    ButtonAttributes,
    CanvasAttributes,
    ColumnAttributes,
    DetailsAttributes,
    DialogAttributes,
    EditAttributes,
    EmbedAttributes,
    FieldsetAttributes,
    FormAttributes,
    HtmlRootAttributes,
    IframeAttributes,
    ImageAttributes,
    InputAttributes,
    LabelAttributes,
    LinkAttributes,
    ListItemAttributes,
    MapAttributes,
    MediaAttributes,
    MetaAttributes,
    MeterAttributes,
    ObjectAttributes,
    OptGroupAttributes,
    OptionAttributes,
    OrderedListAttributes,
    OutputAttributes,
    ProgressAttributes,
    QuoteAttributes,
    ScriptAttributes,
    SelectAttributes,
    SlotAttributes,
    SourceAttributes,
    StyleElementAttributes,
    TableAttributes,
    TableCellAttributes,
    TextareaAttributes,
    TimeAttributes,
    TrackAttributes,
    VideoAttributes } from './jsx-element-attributes.model';
import { HtmlAttributes } from './jsx.model';

/**
 * Every html tag that carries no attributes beyond the global ones. Listing them explicitly is what
 * makes a typo like `<dvi>` a compile error.
 */
type PlainElementTag
    = | 'abbr' | 'address' | 'article' | 'aside' | 'b' | 'bdi' | 'bdo' | 'body' | 'br' | 'caption'
        | 'cite' | 'code' | 'data' | 'datalist' | 'dd' | 'dfn' | 'div' | 'dl' | 'dt' | 'em' | 'figcaption'
        | 'figure' | 'footer' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'head' | 'header' | 'hgroup'
        | 'hr' | 'i' | 'kbd' | 'legend' | 'main' | 'mark' | 'menu' | 'nav' | 'noscript' | 'p' | 'picture'
        | 'pre' | 'rp' | 'rt' | 'ruby' | 's' | 'samp' | 'search' | 'section' | 'small' | 'span' | 'strong'
        | 'sub' | 'summary' | 'sup' | 'tbody' | 'template' | 'tfoot' | 'thead' | 'title' | 'tr' | 'u'
        | 'ul' | 'var' | 'wbr';

/**
 * The html elements that can be used in a template, mapped to the props they accept.
 */
export type IntrinsicElements = {
    [Tag in PlainElementTag]: HtmlAttributes;
} & {
    /**
     * A hyperlink.
     */
    a: AnchorAttributes,
    /**
     * A clickable area inside an image map.
     */
    area: AreaAttributes,
    /**
     * Embedded sound content.
     */
    audio: MediaAttributes,
    /**
     * The base url for all relative urls in the document.
     */
    base: BaseAttributes,
    /**
     * A long quotation.
     */
    blockquote: QuoteAttributes,
    /**
     * A clickable button.
     */
    button: ButtonAttributes,
    /**
     * A surface for drawing graphics.
     */
    canvas: CanvasAttributes,
    /**
     * A single column of a table.
     */
    col: ColumnAttributes,
    /**
     * A group of table columns.
     */
    colgroup: ColumnAttributes,
    /**
     * Content that was removed from the document.
     */
    del: EditAttributes,
    /**
     * A disclosure widget.
     */
    details: DetailsAttributes,
    /**
     * A modal or non modal dialog.
     */
    dialog: DialogAttributes,
    /**
     * An external application or plugin.
     */
    embed: EmbedAttributes,
    /**
     * A group of form controls.
     */
    fieldset: FieldsetAttributes,
    /**
     * A form for user input.
     */
    form: FormAttributes,
    /**
     * The root of the document.
     */
    html: HtmlRootAttributes,
    /**
     * An embedded browsing context.
     */
    iframe: IframeAttributes,
    /**
     * An image.
     */
    img: ImageAttributes,
    /**
     * A form input control.
     */
    input: InputAttributes,
    /**
     * Content that was added to the document.
     */
    ins: EditAttributes,
    /**
     * A caption for a form control.
     */
    label: LabelAttributes,
    /**
     * A list item.
     */
    li: ListItemAttributes,
    /**
     * A relationship to an external resource.
     */
    link: LinkAttributes,
    /**
     * An image map.
     */
    map: MapAttributes,
    /**
     * A scalar value within a known range.
     */
    meter: MeterAttributes,
    /**
     * Metadata about the document.
     */
    meta: MetaAttributes,
    /**
     * An external resource.
     */
    object: ObjectAttributes,
    /**
     * An ordered list.
     */
    ol: OrderedListAttributes,
    /**
     * A group of options in a select.
     */
    optgroup: OptGroupAttributes,
    /**
     * An option in a select or datalist.
     */
    option: OptionAttributes,
    /**
     * The result of a calculation.
     */
    output: OutputAttributes,
    /**
     * The progress of a task.
     */
    progress: ProgressAttributes,
    /**
     * A short inline quotation.
     */
    q: QuoteAttributes,
    /**
     * A script.
     */
    script: ScriptAttributes,
    /**
     * A control for selecting one of multiple options.
     */
    select: SelectAttributes,
    /**
     * A shadow dom slot.
     */
    slot: SlotAttributes,
    /**
     * An alternative source for a media or picture element.
     */
    source: SourceAttributes,
    /**
     * Embedded style information.
     */
    style: StyleElementAttributes,
    /**
     * Tabular data.
     */
    table: TableAttributes,
    /**
     * A data cell of a table.
     */
    td: TableCellAttributes,
    /**
     * A multi line text input control.
     */
    textarea: TextareaAttributes,
    /**
     * A header cell of a table.
     */
    th: TableCellAttributes,
    /**
     * A date or time.
     */
    time: TimeAttributes,
    /**
     * A text track for a media element.
     */
    track: TrackAttributes,
    /**
     * Embedded video content.
     */
    video: VideoAttributes
};