import { useEffect, useState } from "react";
import type { Tag } from "../../types";
import { TAGS_KEY } from "../../lib/constants";
import { getTags, setTags } from "../../lib/storage";
import { Icon } from "../components/Icons";
import { ConfirmDialog } from "../components/ConfirmDialog";

/** Starter tags the user can add with one click. */
const EXAMPLES: { label: string; prompt: string }[] = [
  { label: "Citations", prompt: "Include the specific sources, studies, or references the video relies on." },
  { label: "Tutorial", prompt: "Frame the key takeaways as concrete step-by-step instructions." },
  { label: "Pricing", prompt: "Call out any prices, costs, or hard numbers mentioned." },
  { label: "Counterpoints", prompt: "Note the strongest objections or caveats the video glosses over." },
];

export function TagsSection() {
  const [tags, setTagsState] = useState<Tag[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    void getTags().then((t) => {
      setTagsState(t);
      setLoaded(true);
    });
    // Reflect quick-create from the on-page widget (writes the same key).
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[TAGS_KEY]) {
        setTagsState((changes[TAGS_KEY].newValue as Tag[]) ?? []);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  /** Live edit in local state (smooth typing); persisted on blur / add / delete. */
  function editLocal(id: string, patch: Partial<Tag>) {
    setTagsState((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async function persist(next?: Tag[]) {
    const value = next ?? tags;
    if (next) setTagsState(next);
    await setTags(value);
  }

  function addTag(seed?: { label: string; prompt: string }) {
    void persist([
      ...tags,
      { id: crypto.randomUUID(), label: seed?.label ?? "", prompt: seed?.prompt ?? "" },
    ]);
  }

  function deleteTag(id: string) {
    void persist(tags.filter((t) => t.id !== id));
    setDeleteId(null);
  }

  if (!loaded) return <p className="text-muted">Loading…</p>;

  const unusedExamples = EXAMPLES.filter(
    (ex) => !tags.some((t) => t.label.trim().toLowerCase() === ex.label.toLowerCase()),
  );

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Tags</h1>
        <p className="section-desc">
          Tags are reusable instructions woven into the summary prompt. Attach a tag to a channel
          from the on-page <strong>Tags</strong> row (or to a single video), and the summary also
          addresses it — e.g. citations, a tutorial framing, or pricing. This is the tag library;
          create and edit them here.
        </p>
      </div>

      {tags.length === 0 ? (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          No tags yet. Add one below, or start from an example.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {tags.map((tag) => (
            <div key={tag.id} className="card" style={{ marginBottom: 0 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                <input
                  type="text"
                  value={tag.label}
                  placeholder="Tag name (e.g. Citations)"
                  onChange={(e) => editLocal(tag.id, { label: e.target.value })}
                  onBlur={() => void persist()}
                  style={{ flex: 1, fontWeight: 600 }}
                />
                <button
                  className="icon-action danger"
                  title="Delete tag"
                  aria-label="Delete tag"
                  onClick={() => setDeleteId(tag.id)}
                >
                  <Icon name="trash" />
                </button>
              </div>
              <textarea
                rows={2}
                value={tag.prompt}
                placeholder="What should the AI do? e.g. 'Include the sources the video relies on.'"
                onChange={(e) => editLocal(tag.id, { prompt: e.target.value })}
                onBlur={() => void persist()}
                style={{ width: "100%", resize: "vertical", fontFamily: "inherit", fontSize: 14 }}
              />
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn btn-primary btn-icon-text" onClick={() => addTag()}>
          <Icon name="plus" />
          Add tag
        </button>
        {unusedExamples.map((ex) => (
          <button key={ex.label} className="btn btn-ghost" onClick={() => addTag(ex)}>
            + {ex.label}
          </button>
        ))}
      </div>

      {deleteId && (
        <ConfirmDialog
          title="Delete this tag?"
          body="Removing it from the library also stops it applying to any channels or videos it was on."
          confirmLabel="Delete Tag"
          onCancel={() => setDeleteId(null)}
          onConfirm={() => deleteTag(deleteId)}
        />
      )}
    </div>
  );
}
