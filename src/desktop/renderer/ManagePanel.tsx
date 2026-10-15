import { useState } from "react";
import type { ApplicationId, SkillImportPreview, SkillImportReceipt } from "../../types.js";
import { AlertIcon, ShieldIcon } from "./Icons.js";

export function ManagePanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const [preview, setPreview] = useState<SkillImportPreview | null>(null);
  const [receipt, setReceipt] = useState<SkillImportReceipt | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(application: ApplicationId): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const selection = await window.skillManager.chooseSkillImport(application);
      if (selection.status === "ready") {
        setPreview(selection.preview);
        setReceipt(null);
        setRecovery(null);
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
        setReceipt(result);
        setPreview(null);
        await onChanged();
      }
    } catch (cause) {
      setError(getMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function undo(): Promise<void> {
    if (!receipt) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.skillManager.undoSkillImport(receipt.id);
      if (result) {
        setRecovery(result);
        setReceipt(null);
        await onChanged();
      }
    } catch (cause) {
      setError(getMessage(cause));
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
            {receipt ? (
              <div className="manage-preview">
                <p>
                  Imported and verified {receipt.fileCount} files at {receipt.destinationDirectory}.
                </p>
                <button type="button" disabled={busy} onClick={() => void undo()}>
                  Undo this import
                </button>
              </div>
            ) : recovery ? (
              <p className="manage-placeholder">
                Import undone. Its files remain recoverable at {recovery}.
              </p>
            ) : (
              <p className="manage-placeholder">
                After import, you can undo it while this app session stays open, provided the skill
                has not changed.
              </p>
            )}
          </div>
        </div>
      </section>

      <p className="manage-disclaimer">
        <ShieldIcon /> Folder imports only. Archives, overwrites, updates, and automatic setup
        scripts are intentionally unsupported.
      </p>
    </>
  );
}

function getMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The import could not be completed.";
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
