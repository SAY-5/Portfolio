type Props = {
  dir?: 'ne' | 'left' | 'right';
  size?: number;
  className?: string;
};

const PATHS: Record<NonNullable<Props['dir']>, string> = {
  ne: 'M4.2 11.8 11.8 4.2M5.6 4.2h6.2v6.2',
  left: 'M13 8H3M7.4 3.6 3 8l4.4 4.4',
  right: 'M3 8h10M8.6 3.6 13 8l-4.4 4.4',
};

// One arrow, one stroke weight, three directions. Decorative by default.
export default function Arrow({ dir = 'ne', size = 14, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path
        d={PATHS[dir]}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
