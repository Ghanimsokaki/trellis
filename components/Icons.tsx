type IconProps = { className?: string; strokeWidth?: number };

const base = (className?: string) => `shrink-0 ${className ?? "h-4 w-4"}`;

function Svg({ className, strokeWidth = 1.6, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={base(className)}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconCube(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.8 20.5 7.4v9.2L12 21.2 3.5 16.6V7.4Z" />
      <path d="m3.7 7.5 8.3 4.6 8.3-4.6M12 12.1v9" opacity="0.75" />
    </Svg>
  );
}

export function IconSparkles(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5l1.6 4.6 4.6 1.6-4.6 1.6L12 15.9l-1.6-4.6L5.8 9.7l4.6-1.6Z" />
      <path d="M18.4 15.2l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z" opacity="0.7" />
      <path d="M5.2 16.4l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5Z" opacity="0.6" />
    </Svg>
  );
}

export function IconImage(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.2" y="4.5" width="17.6" height="15" rx="2.6" />
      <circle cx="8.6" cy="9.6" r="1.5" />
      <path d="m3.8 17.4 4.7-4.6a2 2 0 0 1 2.8 0l3.2 3.2m0 0 1.8-1.8a2 2 0 0 1 2.8 0l1.3 1.3m-5.9.5 2.5 2.5" />
    </Svg>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 16.5V4.5m0 0L7.6 9M12 4.5 16.4 9" />
      <path d="M4.5 15v3.2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15" />
    </Svg>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4.5v11.2m0 0 4.4-4.4M12 15.7 7.6 11.3" />
      <path d="M4.5 16.2v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" />
    </Svg>
  );
}

export function IconRotate(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 11.5a8 8 0 1 0-2.6 6" />
      <path d="M20.4 4.6v5h-5" />
    </Svg>
  );
}

export function IconGrid(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="2.4" />
      <path d="M3.8 9.4h16.4M3.8 14.6h16.4M9.4 3.8v16.4M14.6 3.8v16.4" opacity="0.7" />
    </Svg>
  );
}

export function IconWireframe(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.2 20.4 7.8v8.4L12 20.8 3.6 16.2V7.8Z" />
      <path d="M3.8 7.9 12 12.4l8.2-4.5M12 12.4v8.2M7.8 5.5l8.4 13" opacity="0.65" />
    </Svg>
  );
}

export function IconSun(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.8v2.2M12 19v2.2M4.5 12H2.3M21.7 12h-2.2M6.7 6.7 5.1 5.1M18.9 18.9l-1.6-1.6M17.3 6.7l1.6-1.6M5.1 18.9l1.6-1.6" />
    </Svg>
  );
}

export function IconDice(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3.4" />
      <circle cx="8.4" cy="8.4" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="15.6" cy="15.6" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.05" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconX(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Svg>
  );
}

export function IconAlert(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.9 21 19.6H3Z" />
      <path d="M12 9.4v4.3" />
      <circle cx="12" cy="16.8" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4.8 12.6 4.5 4.4 9.9-10" />
    </Svg>
  );
}

export function IconSpinner(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={base(props.className ?? "h-4 w-4 animate-spin")} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.2" opacity="0.18" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 12h15m0 0-6-6m6 6-6 6" />
    </Svg>
  );
}

export function IconKey(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8.2" cy="8.2" r="3.7" />
      <path d="m10.9 10.9 8.4 8.4M16.6 16.5l1.9-1.9M19.2 19.1l1.9-1.9" />
    </Svg>
  );
}

export function IconExternal(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13.8 4.5h5.7v5.7M19.3 4.7l-7.6 7.6" />
      <path d="M18.6 14.4v4a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </Svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="8.6" y="8.6" width="11.6" height="11.6" rx="2.4" />
      <path d="M15.4 5.6V5a2 2 0 0 0-2-2H5.8a2 2 0 0 0-2 2v7.6a2 2 0 0 0 2 2h.6" />
    </Svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.8 6.8h14.4M9.6 6.8V4.9a1.4 1.4 0 0 1 1.4-1.4h2a1.4 1.4 0 0 1 1.4 1.4v1.9" />
      <path d="M6.6 6.8 7.5 19a1.6 1.6 0 0 0 1.6 1.5h5.8A1.6 1.6 0 0 0 16.5 19l.9-12.2" />
      <path d="M10.4 10.5v6.2M13.6 10.5v6.2" opacity="0.7" />
    </Svg>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m12 3.4 8.4 4.5-8.4 4.5L3.6 7.9Z" />
      <path d="m3.6 12.4 8.4 4.5 8.4-4.5M3.6 16.6l8.4 4.5 8.4-4.5" opacity="0.7" />
    </Svg>
  );
}

export function IconChip(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6.6" y="6.6" width="10.8" height="10.8" rx="2.2" />
      <path d="M10 3.2v3.4M14 3.2v3.4M10 17.4v3.4M14 17.4v3.4M3.2 10h3.4M3.2 14h3.4M17.4 10h3.4M17.4 14h3.4" opacity="0.75" />
    </Svg>
  );
}

export function IconCode(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m8.4 8-4.4 4 4.4 4M15.6 8l4.4 4-4.4 4M13.6 4.8l-3.2 14.4" />
    </Svg>
  );
}
