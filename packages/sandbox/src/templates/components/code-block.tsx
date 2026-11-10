import { MdxCodeBlockProps, TsxComponent } from 'zibri';

// the code of a page written in markdown, each token colored by its class in the stylesheet, and the text no kind
// colors in One Dark's color, like the tokens
export const CodeBlock: TsxComponent<MdxCodeBlockProps> = ({ language, children }) => {
    return (
        <pre className="my-4 p-4 rounded-sm bg-dark-gray overflow-x-auto text-sm text-[#abb2bf]">
            <code className={language === undefined ? '' : `language-${language}`}>{children}</code>
        </pre>
    );
};