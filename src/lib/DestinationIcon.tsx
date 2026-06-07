/** Brand-accurate icon for each destination service (28×28 by default). */
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
          {/* Google Gemini 4-pointed star */}
          <path
            d="M14 3C14 10.2 16.3 13 25 14C16.3 14 14 16.8 14 25C14 16.8 11.7 14 3 14C11.7 14 14 10.2 14 3Z"
            fill="white"
          />
        </svg>
      );

    case "chatgpt":
      return (
        <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx={rx} fill="#10a37f" />
          {/* OpenAI logo — actual Simple Icons path, scaled into 20×20 at (4,4) */}
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
        <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx={rx} fill="#D97757" />
          {/* Anthropic 'A' logomark — actual Simple Icons path */}
          <svg x="4" y="4" width="20" height="20" viewBox="0 0 24 24">
            <path
              fill="white"
              fillRule="evenodd"
              d="M13.527 6.684h-3.054L4.919 17.316H7.79l1.463-3.967h5.494l1.463 3.967h2.871zM10.146 11.28l1.854-5.023 1.854 5.023z"
            />
          </svg>
        </svg>
      );

    case "notebooklm":
      return (
        <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx={rx} fill="#1a73e8" />
          {/* Notebook with spine rings */}
          <rect x="9" y="5" width="13" height="18" rx="1.5" fill="white" />
          <rect x="6" y="8" width="3" height="2.5" rx="1" fill="white" />
          <rect x="6" y="12.75" width="3" height="2.5" rx="1" fill="white" />
          <rect x="6" y="17.5" width="3" height="2.5" rx="1" fill="white" />
          <path d="M12 10h7M12 13.5h7M12 17h4.5" stroke="#1a73e8" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );

    case "perplexity":
      return (
        <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx={rx} fill="#20808d" />
          {/* Perplexity logo — diamond/thread mark */}
          <path
            d="M14 4L21 10.5V13h-5.5v8h-3v-8H7v-2.5z"
            fill="white"
          />
          <path d="M7 21h14" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
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
