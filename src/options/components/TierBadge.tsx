/**
 * Small pill marking which product tier a feature belongs to.
 * - "basic": works with no API key (neutral styling)
 * - "integrated": requires the Direct API / Gemini key (accent styling)
 *
 * Purely visual/organizational — no gating logic lives here.
 */
export function TierBadge({
  tier,
  label,
  style,
}: {
  tier: "basic" | "integrated";
  label?: string;
  style?: React.CSSProperties;
}) {
  const text = label ?? (tier === "basic" ? "Basic" : "Needs API key");
  return (
    <span
      className={`tier-badge ${tier === "basic" ? "tier-badge-basic" : "tier-badge-integrated"}`}
      style={style}
    >
      {text}
    </span>
  );
}
