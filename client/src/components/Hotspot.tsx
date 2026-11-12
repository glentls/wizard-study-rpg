import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

/** A clickable, keyboard-accessible region of an SVG scene. */
export function Hotspot({
  label,
  onActivate,
  disabled = false,
  inactive = false,
  className = '',
  children,
}: {
  label: string;
  onActivate: (el: Element) => void;
  /** Visible but locked (e.g. the portal under construction). Still clickable to explain why. */
  disabled?: boolean;
  /** Not interactive at all (e.g. while the title screen is showing). */
  inactive?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const activate = (e: MouseEvent<SVGGElement> | KeyboardEvent<SVGGElement>) => {
    e.stopPropagation();
    onActivate(e.currentTarget);
  };
  return (
    <g
      className={`hotspot${disabled ? ' hotspot--disabled' : ''} ${className}`}
      role={inactive ? undefined : 'button'}
      tabIndex={inactive ? -1 : 0}
      aria-label={inactive ? undefined : label}
      aria-disabled={disabled || undefined}
      onClick={inactive ? undefined : activate}
      onKeyDown={
        inactive
          ? undefined
          : (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activate(e);
              }
            }
      }
    >
      {children}
    </g>
  );
}

/** Text label with a dark outline so it stays readable on any background. */
export function SceneLabel({ x, y, children, size = 30, className = '' }: { x: number; y: number; children: ReactNode; size?: number; className?: string }) {
  return (
    <text x={x} y={y} className={`scene-label ${className}`} fontSize={size} textAnchor="middle">
      {children}
    </text>
  );
}
