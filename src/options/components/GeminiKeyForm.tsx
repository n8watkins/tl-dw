import { useState } from "react";
import type { Settings } from "../../types";
import { DEFAULT_SETTINGS, resolveGeminiModelId } from "../../lib/constants";
import { keyValidationMessage } from "../../lib/geminiKeyValidation";
import { getSettings, setSettings } from "../../lib/storage";

/**
 * Paste, save and verify a Gemini API key. The key is saved locally first and
 * then verified with a metadata read of the chosen model (no summary request);
 * a verified key turns Direct API mode on. Once saved, the key is never shown
 * again: it can be verified again or deleted.
 */
export function GeminiKeyForm({
  settings,
  onSaved,
  idPrefix = "key",
}: {
  settings: Settings;
  /** Called after a save or delete settles (verified or not). */
  onSaved?: (ok: boolean) => void;
  idPrefix?: string;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [verifying, setVerifying] = useState(false);

  async function verify(enableOnSuccess: boolean): Promise<boolean> {
    setVerifying(true);
    try {
      const result = (await chrome.runtime.sendMessage({ type: "VERIFY_GEMINI_KEY", enableOnSuccess })) as
        | { ok?: boolean }
        | undefined;
      return !!result?.ok;
    } finally {
      setVerifying(false);
    }
  }

  async function save() {
    const key = value.trim();
    if (!key) return;
    const current = await getSettings();
    await setSettings({
      ...current,
      geminiApiKey: key,
      geminiApiKeyName: name.trim() || "Gemini API key",
      geminiKeyValidation: { status: "unverified" },
    });
    setName("");
    setValue("");
    // Verify first, then report: `onSaved?.(await verify(true))` would skip the
    // verification entirely when no onSaved is passed.
    const ok = await verify(true);
    onSaved?.(ok);
  }

  async function remove() {
    const current = await getSettings();
    await setSettings({
      ...current,
      geminiApiKey: "",
      geminiApiKeyName: "",
      geminiKeyValidation: DEFAULT_SETTINGS.geminiKeyValidation,
      useDirectApi: false,
    });
    onSaved?.(false);
  }

  const model = resolveGeminiModelId(settings.geminiModelId);

  if (settings.geminiApiKey) {
    const invalid = settings.geminiKeyValidation.status === "invalid";
    const valid = settings.geminiKeyValidation.status === "valid";
    return (
      <div className="key-saved">
        <div className="key-saved-row">
          <span className="key-saved-name">
            <span aria-hidden="true">{valid ? "✓" : "!"}</span> {settings.geminiApiKeyName || "Gemini API key"}
          </span>
          <button className="btn btn-ghost" onClick={() => void verify(false)} disabled={verifying}>
            {verifying ? "Verifying…" : "Verify again"}
          </button>
          <button className="btn btn-danger" onClick={() => void remove()}>
            Delete key
          </button>
        </div>
        <div className={`key-status${invalid ? " key-status-invalid" : valid ? " key-status-valid" : ""}`} role="status">
          {verifying ? "Verifying your key…" : keyValidationMessage(settings.geminiKeyValidation, model)}
        </div>
        <div className="key-hint">
          {invalid
            ? "To use a different key, delete this one and paste the new key."
            : "The key is hidden after saving. Delete it before adding a replacement."}
        </div>
      </div>
    );
  }

  return (
    <form
      className="key-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="field-label" htmlFor={`${idPrefix}-value`}>
        Gemini API key
      </label>
      <input
        id={`${idPrefix}-value`}
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste API key - you won't be able to view it after saving"
        className="key-input"
        autoComplete="new-password"
        spellCheck={false}
      />
      <label className="field-label" htmlFor={`${idPrefix}-name`}>
        Name (optional)
      </label>
      <input
        id={`${idPrefix}-name`}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name this key (e.g. Personal AI Studio key)"
        autoComplete="off"
      />
      <div>
        <button className="btn btn-primary" type="submit" disabled={!value.trim() || verifying}>
          {verifying ? "Verifying…" : "Save key"}
        </button>
      </div>
    </form>
  );
}
