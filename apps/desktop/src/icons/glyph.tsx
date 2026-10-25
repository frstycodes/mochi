import {
  forwardRef,
  type ForwardRefExoticComponent,
  type RefAttributes,
  type SVGAttributes,
} from 'react';

export interface IconProps extends Omit<
  SVGAttributes<SVGSVGElement>,
  'stroke' | 'strokeWidth'
> {
  size?: number | string;
  strokeWidth?: number;
  /** The solid version of the glyph; custom glyphs have none and draw the outline. */
  filled?: boolean;
}

export type IconComponent = ForwardRefExoticComponent<
  IconProps & RefAttributes<SVGSVGElement>
>;

/** A glyph Solar doesn't ship, as SVG markup drawn on its 24px grid at its 1.5 stroke. */
export function customIcon(name: string, markup: string): IconComponent {
  const Icon = forwardRef<SVGSVGElement, IconProps>(
    ({ filled: _filled, size = 24, ...props }, ref) => (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        {...props}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    ),
  );
  Icon.displayName = name;
  return Icon;
}
