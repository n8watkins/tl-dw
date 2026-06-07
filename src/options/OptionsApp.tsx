import { useState } from "react";
import { SetupSection } from "./sections/SetupSection";
import { ProfilesSection } from "./sections/ProfilesSection";
import { HistorySection } from "./sections/HistorySection";
import { ChannelsSection } from "./sections/ChannelsSection";
import { SettingsSection } from "./sections/SettingsSection";
import { DirectApiSection } from "./sections/DirectApiSection";
import { AboutSection } from "./sections/AboutSection";
import { SupportSection } from "./sections/SupportSection";

type NavItem = "setup" | "profiles" | "history" | "channels" | "settings" | "directapi" | "support" | "about";

const NAV: { id: NavItem; label: string; icon: string }[] = [
  { id: "setup",     label: "Setup",      icon: "◎" },
  { id: "profiles",  label: "Profiles",   icon: "◈" },
  { id: "history",   label: "History",    icon: "◷" },
  { id: "channels",  label: "Channels",   icon: "▦" },
  { id: "settings",  label: "Settings",   icon: "◧" },
  { id: "directapi", label: "Direct API", icon: "⚡" },
  { id: "support",   label: "Support",    icon: "♡" },
  { id: "about",     label: "About",      icon: "◉" },
];

const ICON_URL = chrome.runtime.getURL("icons/tl-dw-48.png");

export function OptionsApp() {
  const [active, setActive] = useState<NavItem>("setup");

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
              onClick={() => setActive(item.id)}
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
        {active === "profiles"  && <ProfilesSection />}
        {active === "history"   && <HistorySection />}
        {active === "channels"  && <ChannelsSection />}
        {active === "settings"  && <SettingsSection />}
        {active === "directapi" && <DirectApiSection />}
        {active === "support"   && <SupportSection />}
        {active === "about"     && <AboutSection />}
      </main>
    </div>
  );
}
