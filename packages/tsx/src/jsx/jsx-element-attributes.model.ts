/* eslint-disable cspell/spellchecker */
import { HtmlAttributes } from './jsx.model';

/**
 * Presentational attributes that are obsolete in html5 but still required by email clients.
 */
export interface LegacyPresentationAttributes {
    /**
     * The width of the element.
     */
    width?: string | number,
    /**
     * The height of the element.
     */
    height?: string | number,
    /**
     * The horizontal alignment of the element's content.
     */
    align?: string,
    /**
     * The vertical alignment of the element's content.
     */
    valign?: string,
    /**
     * The background color of the element.
     */
    bgcolor?: string
}

/**
 * Attributes shared by all form controls.
 */
export interface FormControlAttributes {
    /**
     * The name the control is submitted under.
     */
    name?: string,
    /**
     * Whether the control is disabled.
     */
    disabled?: boolean,
    /**
     * The id of the form the control belongs to.
     */
    form?: string,
    /**
     * Whether the control is focused on page load.
     */
    autofocus?: boolean
}

/**
 * Attributes of the `<html>` element.
 */
export interface HtmlRootAttributes extends HtmlAttributes {
    /**
     * The default xml namespace of the document.
     */
    xmlns?: string
}

/**
 * Attributes of the `<a>` element.
 */
export interface AnchorAttributes extends HtmlAttributes<HTMLAnchorElement> {
    /**
     * The url the link points to.
     */
    href?: string,
    /**
     * Where to open the linked url.
     */
    target?: '_self' | '_blank' | '_parent' | '_top' | string,
    /**
     * The relationship of the linked url to the current document.
     */
    rel?: string,
    /**
     * Downloads the linked url instead of navigating to it, using this file name.
     */
    download?: string | boolean,
    /**
     * The language of the linked url.
     */
    hreflang?: string,
    /**
     * The mime type of the linked url.
     */
    type?: string,
    /**
     * How much referrer information to send.
     */
    referrerpolicy?: string
}

/**
 * Attributes of the `<img>` element.
 */
export interface ImageAttributes extends HtmlAttributes<HTMLImageElement>, LegacyPresentationAttributes {
    /**
     * The url of the image.
     */
    src?: string,
    /**
     * The alternative text of the image.
     */
    alt?: string,
    /**
     * Candidate images for different resolutions.
     */
    srcset?: string,
    /**
     * The sizes the candidate images apply to.
     */
    sizes?: string,
    /**
     * Whether the image is loaded eagerly or when it comes into view.
     */
    loading?: 'eager' | 'lazy',
    /**
     * How the image is decoded.
     */
    decoding?: 'sync' | 'async' | 'auto',
    /**
     * The cors settings used when fetching the image.
     */
    crossorigin?: 'anonymous' | 'use-credentials',
    /**
     * How much referrer information to send.
     */
    referrerpolicy?: string,
    /**
     * The relative priority of the fetch.
     */
    fetchpriority?: 'high' | 'low' | 'auto'
}

/**
 * Attributes of the `<input>` element.
 */
export interface InputAttributes extends HtmlAttributes<HTMLInputElement>, FormControlAttributes {
    /**
     * The kind of control to render.
     */
    type?: string,
    /**
     * The value of the control.
     */
    value?: string | number,
    /**
     * Whether a checkbox or radio is checked.
     */
    checked?: boolean,
    /**
     * The hint shown while the control is empty.
     */
    placeholder?: string,
    /**
     * Whether the value can only be read.
     */
    readonly?: boolean,
    /**
     * Whether a value is required for the form to submit.
     */
    required?: boolean,
    /**
     * The lowest accepted value.
     */
    min?: string | number,
    /**
     * The highest accepted value.
     */
    max?: string | number,
    /**
     * The granularity of accepted values.
     */
    step?: string | number,
    /**
     * The maximum number of accepted characters.
     */
    maxlength?: number,
    /**
     * The minimum number of accepted characters.
     */
    minlength?: number,
    /**
     * A regular expression the value has to match.
     */
    pattern?: string,
    /**
     * The autofill hint for the control.
     */
    autocomplete?: string,
    /**
     * Whether multiple values are accepted.
     */
    multiple?: boolean,
    /**
     * The file types accepted by a file control.
     */
    accept?: string,
    /**
     * The id of a datalist providing suggested values.
     */
    list?: string,
    /**
     * The visible size of the control.
     */
    size?: number,
    /**
     * The url of an image control.
     */
    src?: string,
    /**
     * The width of an image control.
     */
    width?: string | number,
    /**
     * The height of an image control.
     */
    height?: string | number
}

/**
 * Attributes of the `<textarea>` element.
 */
export interface TextareaAttributes extends HtmlAttributes<HTMLTextAreaElement>, FormControlAttributes {
    /**
     * The value of the control.
     */
    value?: string | number,
    /**
     * The visible number of lines.
     */
    rows?: number,
    /**
     * The visible width in characters.
     */
    cols?: number,
    /**
     * The hint shown while the control is empty.
     */
    placeholder?: string,
    /**
     * Whether the value can only be read.
     */
    readonly?: boolean,
    /**
     * Whether a value is required for the form to submit.
     */
    required?: boolean,
    /**
     * The maximum number of accepted characters.
     */
    maxlength?: number,
    /**
     * The minimum number of accepted characters.
     */
    minlength?: number,
    /**
     * How the value is wrapped on submit.
     */
    wrap?: 'hard' | 'soft' | 'off',
    /**
     * The autofill hint for the control.
     */
    autocomplete?: string
}

/**
 * Attributes of the `<button>` element.
 */
export interface ButtonAttributes extends HtmlAttributes<HTMLButtonElement>, FormControlAttributes {
    /**
     * The behavior of the button.
     */
    type?: 'submit' | 'reset' | 'button',
    /**
     * The value the button is submitted with.
     */
    value?: string | number,
    /**
     * The url the form is submitted to, overriding the form's action.
     */
    formaction?: string,
    /**
     * The http method the form is submitted with, overriding the form's method.
     */
    formmethod?: string,
    /**
     * Whether form validation is skipped on submit.
     */
    formnovalidate?: boolean,
    /**
     * Where the form response is displayed, overriding the form's target.
     */
    formtarget?: string,
    /**
     * The id of the popover the button controls.
     */
    popovertarget?: string,
    /**
     * What the button does to the controlled popover.
     */
    popovertargetaction?: 'toggle' | 'show' | 'hide'
}

/**
 * Attributes of the `<select>` element.
 */
export interface SelectAttributes extends HtmlAttributes<HTMLSelectElement>, FormControlAttributes {
    /**
     * The selected value.
     */
    value?: string | number,
    /**
     * Whether multiple options can be selected.
     */
    multiple?: boolean,
    /**
     * Whether a value is required for the form to submit.
     */
    required?: boolean,
    /**
     * The number of visible options.
     */
    size?: number,
    /**
     * The autofill hint for the control.
     */
    autocomplete?: string
}

/**
 * Attributes of the `<option>` element.
 */
export interface OptionAttributes extends HtmlAttributes<HTMLOptionElement> {
    /**
     * The value the option submits.
     */
    value?: string | number,
    /**
     * Whether the option is selected.
     */
    selected?: boolean,
    /**
     * Whether the option can be selected.
     */
    disabled?: boolean,
    /**
     * The label of the option.
     */
    label?: string
}

/**
 * Attributes of the `<optgroup>` element.
 */
export interface OptGroupAttributes extends HtmlAttributes<HTMLOptGroupElement> {
    /**
     * The label of the group.
     */
    label?: string,
    /**
     * Whether the options in the group can be selected.
     */
    disabled?: boolean
}

/**
 * Attributes of the `<form>` element.
 */
export interface FormAttributes extends HtmlAttributes<HTMLFormElement> {
    /**
     * The url the form is submitted to.
     */
    action?: string,
    /**
     * The http method the form is submitted with.
     */
    method?: 'get' | 'post' | 'dialog',
    /**
     * Where the form response is displayed.
     */
    target?: string,
    /**
     * How the form data is encoded on submit.
     */
    enctype?: string,
    /**
     * Whether validation is skipped on submit.
     */
    novalidate?: boolean,
    /**
     * The autofill behavior of the form's controls.
     */
    autocomplete?: 'on' | 'off',
    /**
     * The name of the form.
     */
    name?: string,
    /**
     * The character encodings accepted on submit.
     */
    'accept-charset'?: string
}

/**
 * Attributes of the `<label>` element.
 */
export interface LabelAttributes extends HtmlAttributes<HTMLLabelElement> {
    /**
     * The id of the labeled control.
     */
    for?: string,
    /**
     * The id of the labeled control, rendered as `for`.
     */
    htmlFor?: string
}

/**
 * Attributes of the `<fieldset>` element.
 */
export interface FieldsetAttributes extends HtmlAttributes<HTMLFieldSetElement> {
    /**
     * Whether all contained controls are disabled.
     */
    disabled?: boolean,
    /**
     * The name of the fieldset.
     */
    name?: string,
    /**
     * The id of the form the fieldset belongs to.
     */
    form?: string
}

/**
 * Attributes of the `<output>` element.
 */
export interface OutputAttributes extends HtmlAttributes<HTMLOutputElement> {
    /**
     * The ids of the controls the output was calculated from.
     */
    for?: string,
    /**
     * The ids of the controls the output was calculated from, rendered as `for`.
     */
    htmlFor?: string,
    /**
     * The name of the output.
     */
    name?: string,
    /**
     * The id of the form the output belongs to.
     */
    form?: string
}

/**
 * Attributes of the `<progress>` element.
 */
export interface ProgressAttributes extends HtmlAttributes<HTMLProgressElement> {
    /**
     * How much of the task is done.
     */
    value?: string | number,
    /**
     * How much work the task requires in total.
     */
    max?: string | number
}

/**
 * Attributes of the `<meter>` element.
 */
export interface MeterAttributes extends HtmlAttributes<HTMLMeterElement> {
    /**
     * The current value.
     */
    value?: string | number,
    /**
     * The lowest value of the range.
     */
    min?: string | number,
    /**
     * The highest value of the range.
     */
    max?: string | number,
    /**
     * The upper bound of the low end of the range.
     */
    low?: string | number,
    /**
     * The lower bound of the high end of the range.
     */
    high?: string | number,
    /**
     * The optimal value of the range.
     */
    optimum?: string | number,
    /**
     * The id of the form the meter belongs to.
     */
    form?: string
}

/**
 * Attributes of the `<table>` element.
 */
export interface TableAttributes extends HtmlAttributes<HTMLTableElement>, LegacyPresentationAttributes {
    /**
     * The width of the border around the table.
     */
    border?: string | number,
    /**
     * The space between a cell's border and its content.
     */
    cellpadding?: string | number,
    /**
     * The space between two cells.
     */
    cellspacing?: string | number,
    /**
     * The role of the table, commonly set to presentation in emails.
     */
    role?: string
}

/**
 * Attributes of the `<td>` and `<th>` elements.
 */
export interface TableCellAttributes extends HtmlAttributes<HTMLTableCellElement>, LegacyPresentationAttributes {
    /**
     * How many columns the cell spans.
     */
    colspan?: number,
    /**
     * How many rows the cell spans.
     */
    rowspan?: number,
    /**
     * The ids of the header cells this cell relates to.
     */
    headers?: string,
    /**
     * The cells a header cell applies to.
     */
    scope?: 'row' | 'col' | 'rowgroup' | 'colgroup',
    /**
     * A short description of a header cell.
     */
    abbr?: string,
    /**
     * Whether the cell's content may wrap.
     */
    nowrap?: boolean
}

/**
 * Attributes of the `<col>` and `<colgroup>` elements.
 */
export interface ColumnAttributes extends HtmlAttributes<HTMLTableColElement>, LegacyPresentationAttributes {
    /**
     * How many columns the element spans.
     */
    span?: number
}

/**
 * Attributes of the `<meta>` element.
 */
export interface MetaAttributes extends HtmlAttributes<HTMLMetaElement> {
    /**
     * The name of the metadata.
     */
    name?: string,
    /**
     * The value of the metadata.
     */
    content?: string,
    /**
     * The character encoding of the document.
     */
    charset?: string,
    /**
     * A pragma directive.
     */
    'http-equiv'?: string,
    /**
     * The media the metadata applies to.
     */
    media?: string,
    /**
     * The open graph property the metadata sets.
     */
    property?: string
}

/**
 * Attributes of the `<link>` element.
 */
export interface LinkAttributes extends HtmlAttributes<HTMLLinkElement> {
    /**
     * The url of the linked resource.
     */
    href?: string,
    /**
     * The relationship of the linked resource to the document.
     */
    rel?: string,
    /**
     * The kind of resource being loaded.
     */
    as?: string,
    /**
     * The mime type of the linked resource.
     */
    type?: string,
    /**
     * The media the linked resource applies to.
     */
    media?: string,
    /**
     * The sizes of a linked icon.
     */
    sizes?: string,
    /**
     * The cors settings used when fetching the resource.
     */
    crossorigin?: 'anonymous' | 'use-credentials',
    /**
     * The subresource integrity hash of the resource.
     */
    integrity?: string,
    /**
     * How much referrer information to send.
     */
    referrerpolicy?: string,
    /**
     * The language of the linked resource.
     */
    hreflang?: string
}

/**
 * Attributes of the `<script>` element.
 */
export interface ScriptAttributes extends HtmlAttributes<HTMLScriptElement> {
    /**
     * The url of the script.
     */
    src?: string,
    /**
     * The mime type of the script.
     */
    type?: string,
    /**
     * Whether the script is fetched in parallel and run as soon as it is available.
     */
    async?: boolean,
    /**
     * Whether the script runs after the document was parsed.
     */
    defer?: boolean,
    /**
     * Whether the script is skipped in browsers supporting modules.
     */
    nomodule?: boolean,
    /**
     * The csp nonce allowing the script to run.
     */
    nonce?: string,
    /**
     * The cors settings used when fetching the script.
     */
    crossorigin?: 'anonymous' | 'use-credentials',
    /**
     * The subresource integrity hash of the script.
     */
    integrity?: string,
    /**
     * How much referrer information to send.
     */
    referrerpolicy?: string
}

/**
 * Attributes of the `<style>` element.
 */
export interface StyleElementAttributes extends HtmlAttributes<HTMLStyleElement> {
    /**
     * The media the styles apply to.
     */
    media?: string,
    /**
     * The csp nonce allowing the styles to apply.
     */
    nonce?: string,
    /**
     * The mime type of the styles.
     */
    type?: string
}

/**
 * Attributes of the `<base>` element.
 */
export interface BaseAttributes extends HtmlAttributes<HTMLBaseElement> {
    /**
     * The base url for relative urls in the document.
     */
    href?: string,
    /**
     * The default target for links in the document.
     */
    target?: string
}

/**
 * Attributes of the `<iframe>` element.
 */
export interface IframeAttributes extends HtmlAttributes<HTMLIFrameElement>, LegacyPresentationAttributes {
    /**
     * The url of the embedded page.
     */
    src?: string,
    /**
     * The inline html of the embedded page.
     */
    srcdoc?: string,
    /**
     * The name of the frame, usable as a link target.
     */
    name?: string,
    /**
     * Whether the frame is loaded eagerly or when it comes into view.
     */
    loading?: 'eager' | 'lazy',
    /**
     * The permission policy of the frame.
     */
    allow?: string,
    /**
     * Whether the frame may go fullscreen.
     */
    allowfullscreen?: boolean,
    /**
     * The restrictions applied to the frame's content.
     */
    sandbox?: string,
    /**
     * How much referrer information to send.
     */
    referrerpolicy?: string
}

/**
 * Attributes of the `<canvas>` element.
 */
export interface CanvasAttributes extends HtmlAttributes<HTMLCanvasElement> {
    /**
     * The width of the drawing surface.
     */
    width?: string | number,
    /**
     * The height of the drawing surface.
     */
    height?: string | number
}

/**
 * Attributes shared by the `<audio>` and `<video>` elements.
 */
export interface MediaAttributes extends HtmlAttributes<HTMLMediaElement> {
    /**
     * The url of the media.
     */
    src?: string,
    /**
     * Whether playback controls are shown.
     */
    controls?: boolean,
    /**
     * Whether playback starts automatically.
     */
    autoplay?: boolean,
    /**
     * Whether playback restarts when the media ends.
     */
    loop?: boolean,
    /**
     * Whether the media is muted.
     */
    muted?: boolean,
    /**
     * What the browser preloads.
     */
    preload?: 'none' | 'metadata' | 'auto',
    /**
     * The cors settings used when fetching the media.
     */
    crossorigin?: 'anonymous' | 'use-credentials'
}

/**
 * Attributes of the `<video>` element.
 */
export interface VideoAttributes extends MediaAttributes {
    /**
     * The image shown before playback starts.
     */
    poster?: string,
    /**
     * The width of the video.
     */
    width?: string | number,
    /**
     * The height of the video.
     */
    height?: string | number,
    /**
     * Whether the video plays inline instead of fullscreen on mobile.
     */
    playsinline?: boolean
}

/**
 * Attributes of the `<source>` element.
 */
export interface SourceAttributes extends HtmlAttributes<HTMLSourceElement> {
    /**
     * The url of the resource.
     */
    src?: string,
    /**
     * Candidate images for different resolutions.
     */
    srcset?: string,
    /**
     * The mime type of the resource.
     */
    type?: string,
    /**
     * The media the resource applies to.
     */
    media?: string,
    /**
     * The sizes the candidate images apply to.
     */
    sizes?: string,
    /**
     * The width of the resource.
     */
    width?: string | number,
    /**
     * The height of the resource.
     */
    height?: string | number
}

/**
 * Attributes of the `<track>` element.
 */
export interface TrackAttributes extends HtmlAttributes<HTMLTrackElement> {
    /**
     * The url of the track file.
     */
    src?: string,
    /**
     * The kind of text track.
     */
    kind?: 'subtitles' | 'captions' | 'descriptions' | 'chapters' | 'metadata',
    /**
     * The user visible title of the track.
     */
    label?: string,
    /**
     * The language of the track.
     */
    srclang?: string,
    /**
     * Whether the track is enabled by default.
     */
    default?: boolean
}

/**
 * Attributes of the `<embed>` element.
 */
export interface EmbedAttributes extends HtmlAttributes<HTMLEmbedElement> {
    /**
     * The url of the embedded resource.
     */
    src?: string,
    /**
     * The mime type of the embedded resource.
     */
    type?: string,
    /**
     * The width of the embedded resource.
     */
    width?: string | number,
    /**
     * The height of the embedded resource.
     */
    height?: string | number
}

/**
 * Attributes of the `<object>` element.
 */
export interface ObjectAttributes extends HtmlAttributes<HTMLObjectElement> {
    /**
     * The url of the embedded resource.
     */
    data?: string,
    /**
     * The mime type of the embedded resource.
     */
    type?: string,
    /**
     * The name of the object, usable as a link target.
     */
    name?: string,
    /**
     * The id of the form the object belongs to.
     */
    form?: string,
    /**
     * The width of the object.
     */
    width?: string | number,
    /**
     * The height of the object.
     */
    height?: string | number
}

/**
 * Attributes of the `<ol>` element.
 */
export interface OrderedListAttributes extends HtmlAttributes<HTMLOListElement> {
    /**
     * Whether the list counts down.
     */
    reversed?: boolean,
    /**
     * The number the list starts at.
     */
    start?: number,
    /**
     * The kind of marker used.
     */
    type?: '1' | 'a' | 'A' | 'i' | 'I'
}

/**
 * Attributes of the `<li>` element.
 */
export interface ListItemAttributes extends HtmlAttributes<HTMLLIElement> {
    /**
     * The ordinal value of the item.
     */
    value?: number
}

/**
 * Attributes of the `<details>` element.
 */
export interface DetailsAttributes extends HtmlAttributes<HTMLDetailsElement> {
    /**
     * Whether the details are expanded.
     */
    open?: boolean,
    /**
     * The group the details belong to, so only one stays open.
     */
    name?: string
}

/**
 * Attributes of the `<dialog>` element.
 */
export interface DialogAttributes extends HtmlAttributes<HTMLDialogElement> {
    /**
     * Whether the dialog is shown.
     */
    open?: boolean
}

/**
 * Attributes of the `<time>` element.
 */
export interface TimeAttributes extends HtmlAttributes<HTMLTimeElement> {
    /**
     * The machine readable form of the time.
     */
    datetime?: string
}

/**
 * Attributes of the `<ins>` and `<del>` elements.
 */
export interface EditAttributes extends HtmlAttributes<HTMLModElement> {
    /**
     * The url explaining the change.
     */
    cite?: string,
    /**
     * When the change was made.
     */
    datetime?: string
}

/**
 * Attributes of the `<blockquote>` and `<q>` elements.
 */
export interface QuoteAttributes extends HtmlAttributes<HTMLQuoteElement> {
    /**
     * The url of the quoted source.
     */
    cite?: string
}

/**
 * Attributes of the `<slot>` element.
 */
export interface SlotAttributes extends HtmlAttributes<HTMLSlotElement> {
    /**
     * The name of the slot.
     */
    name?: string
}

/**
 * Attributes of the `<area>` element.
 */
export interface AreaAttributes extends HtmlAttributes<HTMLAreaElement> {
    /**
     * The alternative text of the area.
     */
    alt?: string,
    /**
     * The coordinates of the area's shape.
     */
    coords?: string,
    /**
     * The shape of the area.
     */
    shape?: 'rect' | 'circle' | 'poly' | 'default',
    /**
     * The url the area points to.
     */
    href?: string,
    /**
     * Where to open the linked url.
     */
    target?: string,
    /**
     * The relationship of the linked url to the current document.
     */
    rel?: string,
    /**
     * Downloads the linked url instead of navigating to it, using this file name.
     */
    download?: string | boolean
}

/**
 * Attributes of the `<map>` element.
 */
export interface MapAttributes extends HtmlAttributes<HTMLMapElement> {
    /**
     * The name the map is referenced by.
     */
    name?: string
}