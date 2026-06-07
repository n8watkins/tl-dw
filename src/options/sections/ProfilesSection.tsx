import { useEffect, useState } from "react";
import type { PromptProfile, Settings } from "../../types";
import { getProfiles, getSettings, setProfiles, setSettings } from "../../lib/storage";
import { getOriginalTemplate } from "../../lib/profiles";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icons";

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function hasDuplicateName(profiles: PromptProfile[], id: string, name: string): boolean {
  const normalized = normalizeName(name).toLowerCase();
  return profiles.some((profile) => profile.id !== id && normalizeName(profile.name).toLowerCase() === normalized);
}

function nextAvailableName(profiles: PromptProfile[], baseName: string): string {
  const base = normalizeName(baseName) || "New Profile";
  const used = new Set(profiles.map((profile) => normalizeName(profile.name).toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;

  let index = 2;
  while (used.has(`${base} (${index})`.toLowerCase())) index += 1;
  return `${base} (${index})`;
}

function newProfile(profiles: PromptProfile[]): PromptProfile {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: nextAvailableName(profiles, "New Profile"),
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
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getProfiles(), getSettings()]).then(([p, s]) => {
      setProfilesState(p);
      setSettingsState(s);
    });
  }, []);

  async function save(profile: PromptProfile) {
    const cleanName = normalizeName(profile.name);
    if (!cleanName) {
      setError("Profile name is required.");
      return;
    }
    if (hasDuplicateName(profiles, profile.id, cleanName)) {
      setError(`A profile named "${cleanName}" already exists.`);
      return;
    }

    const original = getOriginalTemplate(profile.id);
    const updated: PromptProfile = {
      ...profile,
      name: cleanName,
      isCustomized: profile.isDefault
        ? profile.promptTemplate !== original
        : undefined,
      updatedAt: new Date().toISOString(),
    };
    const next = profiles.map((p) => (p.id === updated.id ? updated : p));
    setProfilesState(next);
    await setProfiles(next);
    await chrome.runtime.sendMessage({ type: "REBUILD_MENU" });
    setError(null);
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
    const p = newProfile(profiles);
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
    if (settings?.defaultProfileId === id) {
      const nextSettings = { ...settings, defaultProfileId: next[0]?.id };
      setSettingsState(nextSettings);
      await setSettings(nextSettings);
    }
    await chrome.runtime.sendMessage({ type: "REBUILD_MENU" });
    if (openId === id) setOpenId(null);
    setDeleteId(null);
  }

  async function duplicateProfile(profile: PromptProfile) {
    const now = new Date().toISOString();
    const baseName = normalizeName(profile.name) || "New Profile";
    const copy: PromptProfile = {
      ...profile,
      id: crypto.randomUUID(),
      name: nextAvailableName(profiles, baseName),
      isDefault: false,
      isCustomized: undefined,
      createdAt: now,
      updatedAt: now,
    };
    const next = [...profiles, copy];
    setProfilesState(next);
    await setProfiles(next);
    await chrome.runtime.sendMessage({ type: "REBUILD_MENU" });
    setOpenId(copy.id);
    setDrafts((d) => ({ ...d, [copy.id]: copy }));
  }

  async function moveProfile(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= profiles.length) return;
    const next = [...profiles];
    const [profile] = next.splice(index, 1);
    next.splice(target, 0, profile);
    setProfilesState(next);
    await setProfiles(next);
    await chrome.runtime.sendMessage({ type: "REBUILD_MENU" });
  }

  function draft(profile: PromptProfile): PromptProfile {
    return drafts[profile.id] ?? profile;
  }

  function updateDraft(id: string, patch: Partial<PromptProfile>) {
    setError(null);
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
      {error && <div className="inline-error">{error}</div>}

      <div className="profile-list">
        {profiles.map((profile, index) => {
          const d = draft(profile);
          const isOpen = openId === profile.id;
          const isDefault = settings?.defaultProfileId === profile.id;

          return (
            <div key={profile.id} className={`profile-card ${isDefault ? "default-card" : ""}`}>
              <div className="profile-row" onClick={() => setOpenId(isOpen ? null : profile.id)}>
                <div className="profile-name-wrap">
                  <div className="profile-name">{d.name}</div>
                  {d.description?.trim() && (
                    <div className="profile-desc-inline">{d.description}</div>
                  )}
                </div>
                {isDefault && <span className="badge badge-default">Default</span>}
                {!profile.isDefault && <span className="badge badge-custom">Custom</span>}
                <div className="profile-row-actions" onClick={(event) => event.stopPropagation()}>
                  <button
                    className="icon-action"
                    title="Move up"
                    aria-label="Move profile up"
                    disabled={index === 0}
                    onClick={() => void moveProfile(index, -1)}
                  >
                    <Icon name="up" />
                  </button>
                  <button
                    className="icon-action"
                    title="Move down"
                    aria-label="Move profile down"
                    disabled={index === profiles.length - 1}
                    onClick={() => void moveProfile(index, 1)}
                  >
                    <Icon name="down" />
                  </button>
                </div>
                <span className={`chevron ${isOpen ? "open" : ""}`}>
                  <Icon name="chevron" />
                </span>
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
                    <button className="btn btn-primary btn-icon-text" onClick={() => save(d)}>
                      <Icon name="save" />
                      {saved === profile.id ? "Saved ✓" : "Save"}
                    </button>
                    {!isDefault && (
                      <button className="btn btn-ghost btn-icon-text" onClick={() => setDefault(profile.id)}>
                        <Icon name="heart" />
                        Set as Default
                      </button>
                    )}
                    <button className="btn btn-ghost btn-icon-text" onClick={() => void duplicateProfile(d)}>
                      <Icon name="duplicate" />
                      Duplicate
                    </button>
                    {profile.isDefault && profile.isCustomized && (
                      <button className="btn btn-ghost btn-icon-text" onClick={() => resetTemplate(profile)}>
                        <Icon name="reset" />
                        Reset to Original
                      </button>
                    )}
                    {!profile.isDefault && (
                      <button
                        className="btn btn-danger btn-icon-text"
                        onClick={() => setDeleteId(profile.id)}
                      >
                        <Icon name="trash" />
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
      {deleteId && (
        <ConfirmDialog
          title="Delete this profile?"
          body={`"${profiles.find((profile) => profile.id === deleteId)?.name ?? "This profile"}" will be removed from TL;DW. Existing history entries are not changed.`}
          confirmLabel="Delete Profile"
          onCancel={() => setDeleteId(null)}
          onConfirm={() => void deleteProfile(deleteId)}
        />
      )}
    </div>
  );
}
