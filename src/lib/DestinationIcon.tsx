import claudeIcon from "../assets/claude-icon.png";

/** Brand-accurate icon for each destination service (28×28 by default). */
export function DestinationIcon({ id, size = 28 }: { id: string; size?: number }) {
  const rx = Math.round(size * 0.28);
  switch (id) {
    case "gemini":
      // Google Gemini — Simple Icons official path (smooth bezier 4-pointed star)
      return (
        <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
          <defs>
            <linearGradient id="tldw-gm" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
              <stop stopColor="#4285F4" />
              <stop offset="1" stopColor="#9334EA" />
            </linearGradient>
          </defs>
          <rect width="28" height="28" rx={rx} fill="url(#tldw-gm)" />
          <svg x="4" y="4" width="20" height="20" viewBox="0 0 24 24">
            <path
              fill="white"
              d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"
            />
          </svg>
        </svg>
      );

    case "chatgpt":
      // OpenAI — official brand path (not in Simple Icons; sourced from openai.com)
      return (
        <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx={rx} fill="#10a37f" />
          <svg x="4" y="4" width="20" height="20" viewBox="0 0 24 24">
            <path
              fill="white"
              d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0L4.8922 14.09a4.5005 4.5005 0 0 1-2.5513-6.1944zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l3.9993 2.3108a4.4952 4.4952 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l3.9993-2.3108a4.5 4.5 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
            />
          </svg>
        </svg>
      );

    case "claude":
      return (
        <img
          src={claudeIcon}
          width={size}
          height={size}
          style={{ borderRadius: Math.round(size * 0.28), display: "block" }}
          alt="Claude"
        />
      );

    case "notebooklm":
      // NotebookLM — Simple Icons official path (concentric nested arcs)
      return (
        <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx={rx} fill="#1a73e8" />
          <svg x="4" y="4" width="20" height="20" viewBox="0 0 24 24">
            <path
              fill="white"
              d="M11.999 3.201C5.372 3.201 0 8.528 0 15.101V20.8h2.212v-.568c0-2.666 2.178-4.827 4.866-4.827 2.688 0 4.866 2.16 4.866 4.827v.568h2.212v-.568c0-3.877-3.17-7.019-7.078-7.019A7.075 7.075 0 0 0 2.992 14.5a7.355 7.355 0 0 1 6.568-4.016c4.057 0 7.347 3.264 7.347 7.287V20.8h2.212V17.77c0-5.235-4.28-9.481-9.56-9.481a9.563 9.563 0 0 0-6.217 2.28A9.795 9.795 0 0 1 12 5.393c5.406 0 9.788 4.346 9.788 9.707V20.8H24V15.1c-.001-6.573-5.373-11.9-12.001-11.9Z"
            />
          </svg>
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
