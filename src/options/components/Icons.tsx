type IconProps = {
  name:
    | "chevron"
    | "copy"
    | "download"
    | "external"
    | "trash"
    | "reset"
    | "plus"
    | "duplicate"
    | "up"
    | "down"
    | "save"
    | "github"
    | "coffee"
    | "heart";
};

const PATHS: Record<IconProps["name"], string[]> = {
  chevron: ["M6 9l6 6 6-6"],
  copy: ["M8 8h10v10H8z", "M6 14H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"],
  download: ["M12 3v12", "M7 10l5 5 5-5", "M5 21h14"],
  external: ["M14 3h7v7", "M10 14 21 3", "M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"],
  trash: ["M3 6h18", "M8 6V4h8v2", "M6 6l1 16h10l1-16", "M10 11v6", "M14 11v6"],
  reset: ["M3 12a9 9 0 1 0 3-6.7", "M3 4v6h6"],
  plus: ["M12 5v14", "M5 12h14"],
  duplicate: ["M8 8h11v11H8z", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"],
  up: ["M18 15l-6-6-6 6"],
  down: ["M6 9l6 6 6-6"],
  save: ["M5 3h14l2 2v16H3V3h2z", "M7 3v7h10V3", "M8 21v-7h8v7"],
  github: [
    "M9 19c-5 1.5-5-2.5-7-3",
    "M15 22v-3.9a3.4 3.4 0 0 0-.9-2.6c3-.3 6.1-1.5 6.1-6.7a5.2 5.2 0 0 0-1.4-3.6 4.8 4.8 0 0 0-.1-3.6s-1.1-.4-3.7 1.4a12.8 12.8 0 0 0-6.7 0C5.6.6 4.5 1 4.5 1a4.8 4.8 0 0 0-.1 3.6A5.2 5.2 0 0 0 3 8.2c0 5.2 3.1 6.4 6.1 6.7a3.4 3.4 0 0 0-.9 2.6V22",
  ],
  coffee: ["M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8z", "M17 9h1a3 3 0 0 1 0 6h-1", "M7 3v2", "M11 3v2", "M15 3v2"],
  heart: ["M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"],
};

export function Icon({ name }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
