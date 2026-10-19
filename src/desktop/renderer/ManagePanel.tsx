import { useEffect, useState } from "react";
import type { ApplicationId, SkillImportHistoryEntry, SkillImportPreview } from "../../types.js";
import { AlertIcon, ShieldIcon } from "./Icons.js";

export function ManagePanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const [preview, setPreview] = useState<SkillImportPreview | null>(null);
  const [history, setHistory] = useState<SkillImportHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [latestReceiptId, setLatestReceiptId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.skillManager.listSkillImportHistory().then(
      (entries) => {
        if (active) {
          setHistory(entries);
          setHistoryLoading(false);
        }
      },
      (cause) => {
        if (active) {
          setError(getMessage(cause));
          setHistoryLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function refreshHistory(): Promise<void> {
    setHistory(await window.skillManager.listSkillImportHistory());
  }

  async function choose(application: ApplicationId): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const selection = await window.skillManager.chooseSkillImport(application);
      if (selection.status === "ready") {
        setPreview(selection.preview);
      }
    } catch (cause) {
      setError(getMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function apply(): Promise<void> {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.skillManager.applySkillImport(preview.id);
      if (result) {
        setLatestReceiptId(result.id);
        setPreview(null);
        await refreshHistory();
        await onChanged();
      }
    } catch (cause) {
      setError(getMessage(cause));
      await refreshHistory().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function undo(id: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await window.skillManager.undoSkillImport(id);
      if (result) {
        setLatestReceiptId(null);
        await refreshHistory();
        await onChanged();
      }
    } catch (cause) {
      setError(getMessage(cause));
      await refreshHistory().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="intro-row" aria-labelledby="manage-heading">
        <div>
          <p className="section-kicker">SAFE MANAGEMENT</p>
          <h2 id="manage-heading">Add one skill, with a clear way back.</h2>
          <p>
            Import a local skill folder into a global ChatGPT or Claude location. Existing folders
            are never replaced, and no code is run during import.
          </p>
        </div>
      </section>

      {error && (
        <div className="message error-message" role="alert">
          <AlertIcon />
          <span>{error}</span>
        </div>
      )}

      <section className="inventory-card manage-card" aria-label="Import a skill">
        <div className="manage-step">
          <span className="manage-step-number">01</span>
          <div>
            <h3>Choose where it belongs</h3>
            <p>Select an existing local skill folder containing SKILL.md.</p>
            <div className="manage-actions">
              <button type="button" disabled={busy} onClick={() => void choose("chatgpt")}>
                Add to ChatGPT
              </button>
              <button type="button" disabled={busy} onClick={() => void choose("claude")}>
                Add to Claude
              </button>
            </div>
          </div>
        </div>

        <div className="manage-step">
          <span className="manage-step-number">02</span>
          <div>
            <h3>Review the exact destination</h3>
            {preview ? (
              <div className="manage-preview">
                <dl>
                  <div>
                    <dt>From</dt>
                    <dd>{preview.sourceDirectory}</dd>
                  </div>
                  <div>
                    <dt>To</dt>
                    <dd>{preview.destinationDirectory}</dd>
                  </div>
                  <div>
                    <dt>Contents</dt>
                    <dd>
                      {preview.fileCount} files · {formatBytes(preview.totalBytes)}
                    </dd>
                  </div>
                </dl>
                {preview.includesScripts && (
                  <p className="manage-warning">
                    This folder contains scripts. SkillManagerOS will not run them, but the AI
                    application may run them when the skill is used.
                  </p>
                )}
                <button type="button" disabled={busy} onClick={() => void apply()}>
                  Review confirmation and import
                </button>
              </div>
            ) : (
              <p className="manage-placeholder">Choose a folder to see the preview.</p>
            )}
          </div>
        </div>

        <div className="manage-step">
          <span className="manage-step-number">03</span>
          <div>
            <h3>Verify or undo</h3>
            <p className="manage-placeholder">
              Each import is saved below. An unchanged import can be moved to a recovery folder,
              even after restarting the app.
            </p>
          </div>
        </div>
      </section>

      <section className="inventory-card manage-history" aria-labelledby="manage-history-heading">
        <div className="manage-history-heading">
          <div>
            <p className="section-kicker">LOCAL HISTORY</p>
            <h3 id="manage-history-heading">Import history</h3>
          </div>
          <button
            type="button"
            disabled={busy || historyLoading}
            onClick={() => void refreshHistory().catch((cause) => setError(getMessage(cause)))}
          >
            Refresh status
          </button>
        </div>
        {historyLoading ? (
          <p className="manage-placeholder">Checking saved imports…</p>
        ) : history.length === 0 ? (
          <p className="manage-placeholder">No imports have been recorded yet.</p>
        ) : (
          <div className="manage-history-list">
            {history.map((entry) => (
              <article
                key={entry.id}
                className={`manage-history-item${entry.id === latestReceiptId ? " is-latest" : ""}`}
              >
                <div className="manage-history-summary">
                  <div>
                    <strong>{entry.destinationDirectory.split(/[\\/]/).at(-1)}</strong>
                    <span>
                      {entry.application === "chatgpt" ? "ChatGPT" : "Claude"} · {entry.fileCount}{" "}
                      files ·{" "}
                      <time dateTime={entry.appliedAt ?? entry.startedAt}>
                        {new Date(entry.appliedAt ?? entry.startedAt).toLocaleString()}
                      </time>
                    </span>
                  </div>
                  <span className={`manage-status manage-status-${entry.status}`}>
                    {statusLabel(entry.status)}
                  </span>
                </div>
                <p className="manage-history-path">{entry.destinationDirectory}</p>
                {entry.status === "unchanged" ? (
                  <button type="button" disabled={busy} onClick={() => void undo(entry.id)}>
                    Move to recovery
                  </button>
                ) : (
                  <p className="manage-history-note">{statusMessage(entry)}</p>
                )}
                {entry.recoveryDirectory && (
                  <p className="manage-history-path">Recovery: {entry.recoveryDirectory}</p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <p className="manage-disclaimer">
        <ShieldIcon /> Folder imports only. Archives, overwrites, updates, and automatic setup
        scripts are intentionally unsupported.
      </p>
    </>
  );
}

function statusLabel(status: SkillImportHistoryEntry["status"]): string {
  switch (status) {
    case "unchanged":
      return "Ready to undo";
    case "changed":
      return "Changed";
    case "missing":
      return "Missing";
    case "needs-review":
      return "Needs review";
    case "recovered":
      return "Moved to recovery";
  }
}

function statusMessage(entry: SkillImportHistoryEntry): string {
  switch (entry.status) {
    case "changed":
      return "The imported folder no longer matches its saved record. Undo is disabled to protect changes.";
    case "missing":
      return "The imported folder is no longer at this location. No files were changed by this check.";
    case "needs-review":
      return "This operation may have been interrupted or its recovery folder is missing. Review the paths manually; nothing will be retried automatically.";
    case "recovered":
      return "The original folder was moved aside, not deleted.";
    case "unchanged":
      return "";
  }
}

function getMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The import could not be completed.";
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
