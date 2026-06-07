/** Brand-colored icon for each destination service (28×28 by default). */
export function DestinationIcon({ id, size = 28 }: { id: string; size?: number }) {
  const rx = Math.round(size * 0.28);
  switch (id) {
    case "gemini":
      return (
        <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
          <defs>
            <linearGradient id="tldw-gm" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
              <stop stopColor="#4285F4" />
              <stop offset="1" stopColor="#9334EA" />
            </linearGradient>
          </defs>
          <rect width="28" height="28" rx={rx} fill="url(#tldw-gm)" />
          <path
            d="M14 4C14 9.5 16.5 12 23 12C16.5 12 14 14.5 14 24C14 14.5 11.5 12 5 12C11.5 12 14 9.5 14 4Z"
            fill="white"
          />
        </svg>
      );
    case "chatgpt":
      return (
        <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx={rx} fill="#10a37f" />
          <circle cx="14" cy="14" r="6" stroke="white" strokeWidth="1.8" fill="none" />
          <path
            d="M14 8v2.5M19.2 10.8l-1.8 1.8M21 14h-2.5M19.2 17.2l-1.8-1.8M14 20v-2.5M8.8 17.2l1.8-1.8M7 14h2.5M8.8 10.8l1.8 1.8"
            stroke="white"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      );
    case "claude":
      return (
        <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx={rx} fill="#D97757" />
          <path d="M14 5L8 23h3l1.2-3.6h3.6L17 23h3L14 5zm0 5.5 1.2 5.4h-2.4L14 10.5z" fill="white" />
        </svg>
      );
    case "notebooklm":
      return (
        <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx={rx} fill="#1a73e8" />
          <rect x="7" y="5" width="14" height="18" rx="2" stroke="white" strokeWidth="1.5" fill="none" />
          <path d="M10 10h8M10 13.5h8M10 17h5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "perplexity":
      return (
        <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx={rx} fill="#20808d" />
          <path
            d="M9 6h5.5a4.5 4.5 0 0 1 0 9H9V6zM9 15v7"
            stroke="white"
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      );
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx={rx} fill="#475569" />
        </svg>
      );
  }
}
