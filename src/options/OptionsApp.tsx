import { useState } from "react";
import { SetupSection } from "./sections/SetupSection";
import { ProfilesSection } from "./sections/ProfilesSection";
import { HistorySection } from "./sections/HistorySection";
import { SettingsSection } from "./sections/SettingsSection";
import { AboutSection } from "./sections/AboutSection";

type NavItem = "setup" | "profiles" | "history" | "settings" | "about";

const NAV: { id: NavItem; label: string; icon: string }[] = [
  { id: "setup",    label: "Setup",    icon: "◎" },
  { id: "profiles", label: "Profiles", icon: "◈" },
  { id: "history",  label: "History",  icon: "◷" },
  { id: "settings", label: "Settings", icon: "◧" },
  { id: "about",    label: "About",    icon: "◉" },
];

export function OptionsApp() {
  const [active, setActive] = useState<NavItem>("setup");

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-text">TLDW</span>
          <span className="logo-sub">Too Long; Didn't Watch</span>
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
          v{chrome.runtime.getManifest().version}
        </div>
      </aside>

      <main className="content">
        {active === "setup"    && <SetupSection />}
        {active === "profiles" && <ProfilesSection />}
        {active === "history"  && <HistorySection />}
        {active === "settings" && <SettingsSection />}
        {active === "about"    && <AboutSection />}
      </main>
    </div>
  );
}
