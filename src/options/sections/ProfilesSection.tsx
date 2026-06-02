import { useEffect, useState } from "react";
import type { PromptProfile, Settings } from "../../types";
import { getProfiles, getSettings, setProfiles, setSettings } from "../../lib/storage";
import { getOriginalTemplate } from "../../lib/profiles";

function newProfile(): PromptProfile {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: "New Profile",
    description: "",
    promptTemplate: "Analyze this YouTube video: {{url}}\n\n",
    createdAt: now,
    updatedAt: now,
  };
}

export function ProfilesSection() {
  const [profiles, setProfilesState] = useState<PromptProfile[]>([]);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, PromptProfile>>({});
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getProfiles(), getSettings()]).then(([p, s]) => {
      setProfilesState(p);
      setSettingsState(s);
    });
  }, []);

  async function save(profile: PromptProfile) {
    const original = getOriginalTemplate(profile.id);
    const updated: PromptProfile = {
      ...profile,
      isCustomized: profile.isDefault
        ? profile.promptTemplate !== original
        : undefined,
      updatedAt: new Date().toISOString(),
    };
    const next = profiles.map((p) => (p.id === updated.id ? updated : p));
    setProfilesState(next);
    await setProfiles(next);
    await chrome.runtime.sendMessage({ type: "REBUILD_MENU" });
    setSaved(profile.id);
    setTimeout(() => setSaved(null), 2000);
  }

  async function setDefault(id: string) {
    if (!settings) return;
    const next = { ...settings, defaultProfileId: id };
    setSettingsState(next);
    await setSettings(next);
  }

  async function resetTemplate(profile: PromptProfile) {
    const original = getOriginalTemplate(profile.id);
    if (!original) return;
    const reset = { ...profile, promptTemplate: original, isCustomized: false, updatedAt: new Date().toISOString() };
    setDrafts((d) => ({ ...d, [profile.id]: reset }));
    await save(reset);
  }

  async function addProfile() {
    const p = newProfile();
    const next = [...profiles, p];
    setProfilesState(next);
    await setProfiles(next);
    await chrome.runtime.sendMessage({ type: "REBUILD_MENU" });
    setOpenId(p.id);
    setDrafts((d) => ({ ...d, [p.id]: p }));
  }

  async function deleteProfile(id: string) {
    const next = profiles.filter((p) => p.id !== id);
    setProfilesState(next);
    await setProfiles(next);
    await chrome.runtime.sendMessage({ type: "REBUILD_MENU" });
    if (openId === id) setOpenId(null);
  }

  function draft(profile: PromptProfile): PromptProfile {
    return drafts[profile.id] ?? profile;
  }

  function updateDraft(id: string, patch: Partial<PromptProfile>) {
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? profiles.find((p) => p.id === id)!), ...patch } }));
  }

  return (
    <div>
      <div className="profiles-toolbar">
        <div>
          <h1 className="section-title">Profiles</h1>
          <p className="section-desc" style={{ marginTop: 4 }}>
            Reusable prompt templates. Click any profile to edit it.
          </p>
        </div>
        <button className="btn btn-primary" onClick={addProfile}>+ New Profile</button>
      </div>

      <div className="profile-list">
        {profiles.map((profile) => {
          const d = draft(profile);
          const isOpen = openId === profile.id;
          const isDefault = settings?.defaultProfileId === profile.id;

          return (
            <div key={profile.id} className={`profile-card ${isDefault ? "default-card" : ""}`}>
              <div className="profile-row" onClick={() => setOpenId(isOpen ? null : profile.id)}>
                <div className="profile-name">{d.name}</div>
                {isDefault && <span className="badge badge-default">Default</span>}
                {!profile.isDefault && <span className="badge badge-custom">Custom</span>}
                <span className={`chevron ${isOpen ? "open" : ""}`}>▾</span>
              </div>

              {isOpen && (
                <div className="profile-editor">
                  <div className="field-group">
                    <label className="field-label">Name</label>
                    <input
                      type="text"
                      value={d.name}
                      onChange={(e) => updateDraft(profile.id, { name: e.target.value })}
                    />
                  </div>

                  <div className="field-group">
                    <label className="field-label">Description</label>
                    <input
                      type="text"
                      value={d.description ?? ""}
                      onChange={(e) => updateDraft(profile.id, { description: e.target.value })}
                    />
                  </div>

                  <div className="field-group">
                    <label className="field-label">Prompt Template</label>
                    <textarea
                      value={d.promptTemplate}
                      onChange={(e) => updateDraft(profile.id, { promptTemplate: e.target.value })}
                      rows={14}
                    />
                    <p className="var-hints mt-8">
                      Variables:
                      <code>{"{{url}}"}</code>
                      <code>{"{{title}}"}</code>
                      <code>{"{{channel}}"}</code>
                      <code>{"{{date}}"}</code>
                      <code>{"{{userCuriosity}}"}</code>
                      (optional — line removed if not provided)
                    </p>
                  </div>

                  <div className="editor-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => save(d)}>
                      {saved === profile.id ? "Saved ✓" : "Save"}
                    </button>
                    {!isDefault && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setDefault(profile.id)}>
                        Set as Default
                      </button>
                    )}
                    {profile.isDefault && profile.isCustomized && (
                      <button className="btn btn-ghost btn-sm" onClick={() => resetTemplate(profile)}>
                        Reset to Original
                      </button>
                    )}
                    {!profile.isDefault && (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => {
                          if (confirm(`Delete "${profile.name}"?`)) void deleteProfile(profile.id);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
