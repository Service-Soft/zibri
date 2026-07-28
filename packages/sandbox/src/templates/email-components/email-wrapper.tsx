import { MjWrapper, TsxChildren, TsxComponent } from 'zibri';

/**
 * A card-like band that groups whole sections behind a background and rounded corners. Built on
 * MJML's mj-wrapper, so it may only contain sections. `boxShadow` renders where the client supports
 * it and is ignored (not MJML) where it does not.
 */
type Props = {
    children: TsxChildren,
    backgroundColor?: string,
    borderRadius?: string,
    boxShadow?: string,
    padding?: string,
    paddingTop?: string,
    paddingRight?: string,
    paddingBottom?: string,
    paddingLeft?: string,
    cssClass?: string
};

export const EmailWrapper: TsxComponent<Props> = ({
    children,
    backgroundColor,
    borderRadius,
    boxShadow,
    padding = '20px',
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    cssClass
}) => {
    return (
        <MjWrapper
            backgroundColor={backgroundColor}
            borderRadius={borderRadius}
            boxShadow={boxShadow}
            padding={padding}
            paddingTop={paddingTop}
            paddingRight={paddingRight}
            paddingBottom={paddingBottom}
            paddingLeft={paddingLeft}
            cssClass={cssClass}
        >
            {children}
        </MjWrapper>
    );
};