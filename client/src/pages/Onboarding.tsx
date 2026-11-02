import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import type { ElementId } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Alert, Loading } from '../components/ui';
import { ELEMENT_ICON } from '../lib/format';
import { useLoad } from '../lib/useLoad';

interface ElementInfo {
  id: ElementId;
  name: string;
  specialty: string;
  description: string;
  starter_spell: string | null;
}

/** ACC-02 starter wizard: learning goal, name and element, then straight into a guided session. */
export function Onboarding() {
  const { reload } = useAuth();
  const navigate = useNavigate();
  const elements = useLoad(() => api.get<{ elements: ElementInfo[] }>('/v1/content/elements'));
  const [name, setName] = useState('');
  const [element, setElement] = useState<ElementId | null>(null);
  const [goal, setGoal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!element) {
      setError('Choose a starter element.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/v1/wizard', { name, element, learning_goal: goal.trim() || null });
      await reload();
      navigate('/focus?guided=1');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="narrow wide">
      <form className="card stack" onSubmit={submit}>
        <p className="eyebrow">Step 1 of 2</p>
        <h1>Create your wizard</h1>
        {error && <Alert kind="error">{error}</Alert>}

        <label className="field">
          <span>What are you studying for? (optional, private)</span>
          <input value={goal} maxLength={120} placeholder="e.g. Final exams, learning Spanish, CFA level 1" onChange={(e) => setGoal(e.target.value)} />
        </label>

        <label className="field">
          <span>Wizard name</span>
          <input required minLength={3} maxLength={24} value={name} onChange={(e) => setName(e.target.value)} aria-describedby="name-hint" />
          <small id="name-hint" className="muted">
            3-24 characters. This is your public name.
          </small>
        </label>

        <fieldset className="element-picker">
          <legend>Starter element</legend>
          {elements.loading && <Loading />}
          {elements.data?.elements.map((el) => (
            <label key={el.id} className={`element-option el-${el.id} ${element === el.id ? 'selected' : ''}`}>
              <input type="radio" name="element" value={el.id} checked={element === el.id} onChange={() => setElement(el.id)} />
              <span className="element-icon" aria-hidden="true">
                {ELEMENT_ICON[el.id]}
              </span>
              <span className="element-name">{el.name}</span>
              <span className="element-specialty">{el.specialty}</span>
              <span className="muted small">{el.description}</span>
              {el.starter_spell && <span className="small">First spell: {el.starter_spell}</span>}
            </label>
          ))}
        </fieldset>
        <p className="muted small">You can research every element later. Your starter element just decides your first spell.</p>

        <button className="btn btn-primary btn-large" disabled={busy}>
          {busy ? 'Summoning…' : 'Begin my first study session'}
        </button>
      </form>
    </div>
  );
}
