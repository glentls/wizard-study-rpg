import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage, newIdempotencyKey } from '../api/client';
import type { ResearchState, ResearchTree, SpellNode } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Alert, Loading, Meter, PageHeader } from '../components/ui';
import { ELEMENT_ICON, describeEffect } from '../lib/format';
import { useLoad } from '../lib/useLoad';

const STATE_LABEL: Record<ResearchState, string> = {
  LOCKED: 'Locked',
  AVAILABLE: 'Available',
  IN_PROGRESS: 'Researching',
  MILESTONE_PENDING: 'Milestone needed',
  UNLOCKED: 'Unlocked',
  MAXED: 'Mastered',
};

export function Research() {
  const { reload: reloadMe } = useAuth();
  const tree = useLoad(() => api.get<ResearchTree>('/v1/research/tree'));
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const after = async (text: string) => {
    setNotice({ kind: 'success', text });
    await Promise.all([tree.reload(), reloadMe()]);
  };

  if (!tree.data) return tree.error ? <Alert kind="error">{tree.error}</Alert> : <Loading />;
  const t = tree.data;

  return (
    <div className="stack-lg">
      <PageHeader title="Research" subtitle="Spend research points from your focus sessions to unlock and upgrade spells.">
        <span className="balance" aria-live="polite">
          <strong>{t.balance}</strong> RP available
        </span>
      </PageHeader>
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}

      <ManaTrack tree={t} onDone={after} onError={(text) => setNotice({ kind: 'error', text })} />

      {t.elements.map((element) => (
        <section key={element.id} className={`element-section el-${element.id}`} aria-labelledby={`el-${element.id}`}>
          <h2 id={`el-${element.id}`}>
            <span aria-hidden="true">{ELEMENT_ICON[element.id]}</span> {element.name}{' '}
            <span className="muted small">· {element.specialty}</span>
            {element.is_starter && <span className="pill">Your element</span>}
          </h2>
          <div className="spell-grid">
            {element.spells.map((spell) => (
              <SpellCard key={spell.id} spell={spell} balance={t.balance} onDone={after} onError={(text) => setNotice({ kind: 'error', text })} />
            ))}
          </div>
        </section>
      ))}

      <section className="card" aria-labelledby="baseline-title">
        <h2 id="baseline-title" className="h3">
          Known by every wizard
        </h2>
        <ul className="plain">
          {t.baseline.map((b) => (
            <li key={b.id}>
              <strong>{b.name}</strong>: {b.description}
            </li>
          ))}
        </ul>
      </section>
      <p className="muted small">
        Content {t.content_version} · Ruleset {t.ruleset_id}
      </p>
    </div>
  );
}

function SpellCard({ spell, balance, onDone, onError }: { spell: SpellNode; balance: number; onDone: (text: string) => Promise<void>; onError: (text: string) => void }) {
  const remaining = spell.next_cost !== null ? Math.max(0, spell.next_cost - spell.progress) : 0;
  const [amount, setAmount] = useState(Math.min(remaining, balance));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const canFund = spell.state !== 'LOCKED' && spell.state !== 'MAXED' && remaining > 0;
  const titleId = `spell-${spell.id}`;

  const allocate = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ allocated: number; leveled_up_to: number | null }>(
        '/v1/research/allocate',
        { spell_id: spell.id, points: amount, expected_level: spell.level },
        { idempotencyKey: newIdempotencyKey() },
      );
      setConfirming(false);
      await onDone(
        res.leveled_up_to
          ? `${spell.name} reached level ${res.leveled_up_to}!`
          : `Invested ${res.allocated} RP in ${spell.name}.`,
      );
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`card spell-card state-${spell.state.toLowerCase()}`} aria-labelledby={titleId}>
      <header className="spell-head">
        <h3 id={titleId}>{spell.name}</h3>
        <span className="pill">{STATE_LABEL[spell.state]}</span>
      </header>
      <p className="muted small">
        Tier {spell.tier} · {spell.target === 'self' ? 'Self' : 'Enemy'} · {spell.mana_cost} mana
        {spell.cooldown > 0 && ` · ${spell.cooldown}-turn cooldown`}
        {spell.level > 0 && ` · Level ${spell.level}/${spell.max_level}`}
      </p>
      <p>{spell.description}</p>
      <ul className="effects">
        {spell.effects.map((e, i) => (
          <li key={i}>{describeEffect(e)}</li>
        ))}
      </ul>

      {spell.prerequisites.length > 0 && spell.level === 0 && (
        <p className="small">
          Requires:{' '}
          {spell.prerequisites.map((p) => (
            <span key={p.spell_id} className={p.met ? 'prereq met' : 'prereq'}>
              {p.met ? '✓' : '✗'} {p.name} level {p.min_level}
            </span>
          ))}
        </p>
      )}

      {spell.next_cost !== null && spell.state !== 'LOCKED' && (
        <Meter label={spell.level === 0 ? 'Unlock' : `Level ${spell.next_level}`} value={spell.progress} max={spell.next_cost} tone="gold" />
      )}

      {spell.milestone && (
        <p className={spell.milestone.satisfied ? 'small milestone done' : 'small milestone'}>
          {spell.milestone.satisfied
            ? `✓ ${spell.milestone.minutes}-minute milestone complete`
            : `Needs one uninterrupted ${spell.milestone.minutes}-minute focus session.`}
          {!spell.milestone.satisfied && spell.state !== 'LOCKED' && (
            <>
              {' '}
              <Link to={`/focus?target=${spell.id}`}>Attempt milestone</Link>
            </>
          )}
        </p>
      )}

      {canFund && (
        <div className="allocate">
          {!confirming ? (
            <>
              <label className="field inline">
                <span>Points</span>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, Math.min(remaining, balance))}
                  value={amount}
                  onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
                />
              </label>
              <button className="btn" disabled={amount < 1 || amount > balance} onClick={() => setConfirming(true)}>
                Research
              </button>
            </>
          ) : (
            <div className="confirm-row" role="group" aria-label={`Confirm research for ${spell.name}`}>
              <span>
                Spend {amount} RP on {spell.name}?
              </span>
              <button className="btn btn-primary" onClick={allocate} disabled={busy} autoFocus>
                Confirm
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          )}
          {balance < 1 && <p className="muted small">Earn research points by focusing.</p>}
        </div>
      )}
    </article>
  );
}

function ManaTrack({ tree, onDone, onError }: { tree: ResearchTree; onDone: (text: string) => Promise<void>; onError: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const { mana } = tree;
  const upgrade = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ level: number; max_mana: number }>('/v1/research/mana', { expected_level: mana.level }, { idempotencyKey: newIdempotencyKey() });
      await onDone(`Mana capacity is now ${res.max_mana} (level ${res.level}).`);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card mana-track" aria-labelledby="mana-title">
      <div>
        <h2 id="mana-title" className="h3">
          🔷 Mana capacity
        </h2>
        <p className="muted">
          Level {mana.level}/{mana.max_level} · {mana.max_mana} mana
          {mana.next_max_mana && ` → ${mana.next_max_mana} at next level`}
        </p>
      </div>
      {mana.next_cost !== null ? (
        <button className="btn" onClick={upgrade} disabled={busy || tree.balance < mana.next_cost}>
          Upgrade for {mana.next_cost} RP
        </button>
      ) : (
        <span className="pill">Maxed</span>
      )}
    </section>
  );
}
