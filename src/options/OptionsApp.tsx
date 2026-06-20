import { useEffect, useState } from "react";
import { SetupSection } from "./sections/SetupSection";
import { StatsSection } from "./sections/StatsSection";
import { ProfilesSection } from "./sections/ProfilesSection";
import { HistorySection } from "./sections/HistorySection";
import { ChannelsSection } from "./sections/ChannelsSection";
import { TagsSection } from "./sections/TagsSection";
import { SettingsSection } from "./sections/SettingsSection";
import { DirectApiSection } from "./sections/DirectApiSection";
import { AboutSection } from "./sections/AboutSection";
import { SupportSection } from "./sections/SupportSection";

type NavItem = "setup" | "stats" | "profiles" | "history" | "channels" | "tags" | "settings" | "directapi" | "support" | "about";

const NAV: { id: NavItem; label: string; icon: string }[] = [
  { id: "setup",     label: "Setup",      icon: "◎" },
  { id: "stats",     label: "Stats",      icon: "✦" },
  { id: "profiles",  label: "Profiles",   icon: "◈" },
  { id: "history",   label: "History",    icon: "◷" },
  { id: "channels",  label: "Channels",   icon: "▦" },
  { id: "tags",      label: "Tags",       icon: "◆" },
  { id: "settings",  label: "Settings",   icon: "◧" },
  { id: "directapi", label: "Direct API", icon: "⚡" },
  { id: "support",   label: "Support",    icon: "♡" },
  { id: "about",     label: "About",      icon: "◉" },
];

const ICON_URL = chrome.runtime.getURL("icons/tl-dw-48.png");

const NAV_IDS = NAV.map((n) => n.id);
function hashToNav(): NavItem | null {
  const id = window.location.hash.replace(/^#/, "") as NavItem;
  return NAV_IDS.includes(id) ? id : null;
}

export function OptionsApp() {
  // The active section is mirrored in the URL hash (e.g. #directapi) so it's
  // deep-linkable (the Gemini pill on the watch page lands here) and reflected
  // in the address bar.
  const [active, setActive] = useState<NavItem>(() => hashToNav() ?? "setup");

  useEffect(() => {
    const onHashChange = () => {
      const next = hashToNav();
      if (next) setActive(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function navigate(id: NavItem) {
    setActive(id);
    if (window.location.hash !== `#${id}`) window.location.hash = id;
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img className="sidebar-icon" src={ICON_URL} alt="" />
          <div>
            <span className="logo-text">TL;DW</span>
            <span className="logo-sub">Too Long; Didn't Watch</span>
          </div>
        </div>
        <nav>
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${active === item.id ? "active" : ""}`}
              onClick={() => navigate(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span>Version</span>
          <strong>v{chrome.runtime.getManifest().version}</strong>
        </div>
      </aside>

      <main className="content">
        {active === "setup"     && <SetupSection />}
        {active === "stats"     && <StatsSection />}
        {active === "profiles"  && <ProfilesSection />}
        {active === "history"   && <HistorySection />}
        {active === "channels"  && <ChannelsSection />}
        {active === "tags"      && <TagsSection />}
        {active === "settings"  && <SettingsSection />}
        {active === "directapi" && <DirectApiSection />}
        {active === "support"   && <SupportSection />}
        {active === "about"     && <AboutSection />}
      </main>
    </div>
  );
}
