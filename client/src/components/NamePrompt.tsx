import { useState, type FormEvent } from 'react';
import { Modal } from './ui';

/** First-launch pop-up: "You're a wizard, ___!" */
export function NamePrompt({ initial = '', onSubmit, onClose, title }: { initial?: string; onSubmit: (name: string) => void; onClose?: () => void; title?: string }) {
  const [name, setName] = useState(initial);
  const trimmed = name.trim();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <Modal onClose={onClose} className="name-prompt" labelledBy="name-title">
      <form onSubmit={submit}>
        <div className="name-prompt__hat" aria-hidden="true">
          🧙
        </div>
        <h2 id="name-title" className="modal__title">
          {title ?? (
            <>
              You're a wizard,
              <br />
              <span className="name-prompt__name">{trimmed || '...'}</span>!
            </>
          )}
        </h2>
        <label className="field">
          <span className="field__label">What should we call you?</span>
          <input
            className="input"
            value={name}
            maxLength={24}
            autoFocus
            autoComplete="nickname"
            placeholder="Enter your name"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="modal__actions">
          {onClose && (
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn btn--primary" disabled={!trimmed}>
            {onClose ? 'Save' : 'Begin my journey'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
