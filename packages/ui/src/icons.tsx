const PATHS = {
  alert: "M12 8v5M12 16.5v.5M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z",
  check: "M5 12.5 10 17.5 19 7",
  info: "M12 11v6M12 7.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  x: "M6 6l12 12M18 6 6 18",
  copy: "M9 9h10v10H9zM5 15V5h10",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0",
  shield: "M12 3 5 6v6c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V6l-7-3Z",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  dot: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  minus: "M6 12h12",
  more: "M6 12h.01M12 12h.01M18 12h.01",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
