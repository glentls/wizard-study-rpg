import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, errorMessage } from '../api/client';
import type { EncounterList, Match, Statuses } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Alert, Loading, Meter, PageHeader } from '../components/ui';
import { ELEMENT_ICON, dateTime, describeEffect } from '../lib/format';
import { useLoad } from '../lib/useLoad';

export function Adventure() {
  const navigate = useNavigate();
  const list = useLoad(() => api.get<EncounterList>('/v1/encounters'));
  const [error, setError] = useState<string | null>(null);

  const start = async (encounterId: string) => {
    setError(null);
    try {
      const match = await api.post<Match>('/v1/encounters', { encounter_id: encounterId });
      navigate(`/adventure/${match.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MATCH_IN_PROGRESS') {
        navigate(`/adventure/${(err.details as { match_id: string }).match_id}`);
      } else setError(errorMessage(err));
    }
  };

  if (!list.data) return list.error ? <Alert kind="error">{list.error}</Alert> : <Loading />;
  const data = list.data;

  return (
    <div className="stack-lg">
      <PageHeader title="Adventure" subtitle="Turn-based battles to test your spell loadout. Rewards are experience, never research points.">
        <span className="balance">
          {data.daily_xp_remaining}/{data.daily_xp_cap} XP left today
        </span>
      </PageHeader>
      {error && <Alert kind="error">{error}</Alert>}
      {data.open_match_id && (
        <Alert kind="info">
          You have a battle in progress. <Link to={`/adventure/${data.open_match_id}`}>Resume it</Link>
        </Alert>
      )}
      <div className="encounter-grid">
        {data.encounters.map((e) => (
          <article key={e.id} className={`card encounter el-${e.enemy.element}`} aria-labelledby={`enc-${e.id}`}>
            <header className="spell-head">
              <h2 id={`enc-${e.id}`} className="h3">
                <span aria-hidden="true">{ELEMENT_ICON[e.enemy.element]}</span> {e.name}
              </h2>
              {e.tutorial && <span className="pill">Tutorial</span>}
            </header>
            <p>{e.description}</p>
            <p className="muted small">
              {e.enemy.max_hp} HP · {e.enemy.element} · Recommended rank {e.recommended_rank} · {e.xp_reward} XP
              {e.victories > 0 && ` · Won ${e.victories}×`}
            </p>
            {data.rank.level < e.recommended_rank && <p className="small warn-text">Tough fight for your current rank.</p>}
            <button className="btn" onClick={() => start(e.id)} disabled={Boolean(data.open_match_id)}>
              Begin battle
            </button>
          </article>
        ))}
      </div>
      {data.recent.length > 0 && (
        <section className="card" aria-labelledby="recent-battles">
          <h2 id="recent-battles" className="h3">
            Recent battles
          </h2>
          <ul className="ledger-list">
            {data.recent.map((m) => (
              <li key={m.id}>
                <Link to={`/adventure/${m.id}`}>{m.encounter_name}</Link>
                <span className="muted small">{dateTime(m.created_at)}</span>
                <span>{m.state === 'FINISHED' ? (m.winner === 'player' ? `Victory · +${m.reward?.xp ?? 0} XP` : 'Defeat') : m.state.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StatusBadges({ s }: { s: Statuses }) {
  return (
    <span className="badges">
      {s.shield && <span className="badge">🛡 {s.shield.amount}</span>}
      {s.burn && <span className="badge badge-fire">🔥 {s.burn.turns}</span>}
      {s.paralysis && <span className="badge badge-lightning">⚡ paralysed</span>}
      {s.guarding && <span className="badge">guarding</span>}
    </span>
  );
}

export function Battle() {
  const { matchId } = useParams();
  const { reload: reloadMe } = useAuth();
  const match = useLoad(() => api.get<Match>(`/v1/matches/${matchId}`), [matchId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [match.data?.events.length]);

  if (!match.data) return match.error ? <Alert kind="error">{match.error}</Alert> : <Loading />;
  const m = match.data;
  const over = m.state !== 'IN_PROGRESS';

  const act = async (spellId: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.post<Match>(`/v1/matches/${m.id}/actions`, { turn_version: m.turn_version, spell_id: spellId });
      match.setData(next);
      if (next.state !== 'IN_PROGRESS') await reloadMe();
    } catch (err) {
      setError(errorMessage(err));
      await match.reload();
    } finally {
      setBusy(false);
    }
  };

  const forfeit = async () => {
    setBusy(true);
    try {
      match.setData(await api.post<Match>(`/v1/matches/${m.id}/forfeit`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const lastTurn = m.events.at(-1)?.turn ?? 0;

  return (
    <div className="stack-lg battle">
      <PageHeader title={m.encounter.name} subtitle={m.encounter.description}>
        <Link to="/adventure" className="btn btn-ghost">
          Back
        </Link>
      </PageHeader>
      {error && <Alert kind="error">{error}</Alert>}

      <div className="combatants">
        <section className={`card combatant el-${m.player.element}`} aria-label="You">
          <h2 className="h3">
            {ELEMENT_ICON[m.player.element]} {m.player.name} <StatusBadges s={m.player.statuses} />
          </h2>
          <Meter label="HP" value={m.player.hp} max={m.player.max_hp} tone="hp" />
          <Meter label="Mana" value={m.player.mana} max={m.player.max_mana} tone="mana" />
        </section>
        <section className={`card combatant el-${m.enemy.element}`} aria-label="Enemy">
          <h2 className="h3">
            {ELEMENT_ICON[m.enemy.element]} {m.enemy.name} <StatusBadges s={m.enemy.statuses} />
          </h2>
          <Meter label="HP" value={m.enemy.hp} max={m.enemy.max_hp} tone="hp" />
          <p className="muted small">Element: {m.enemy.element}</p>
        </section>
      </div>

      {over ? (
        <section className="card outcome" aria-live="polite">
          <h2>{m.winner === 'player' ? '🏆 Victory!' : m.state === 'ABORTED' ? 'Battle abandoned' : 'Defeated'}</h2>
          {m.reward && (
            <p>
              +{m.reward.xp} XP{m.reward.capped && ` (daily XP cap reached; base reward ${m.reward.base_xp})`}
            </p>
          )}
          <p className="muted">Losing never costs research points or study progress.</p>
          <Link to="/adventure" className="btn btn-primary">
            Back to adventures
          </Link>
        </section>
      ) : (
        <section className="card" aria-labelledby="actions-title">
          <h2 id="actions-title" className="h3">
            Turn {m.turn_version + 1}: choose a spell
          </h2>
          <div className="action-grid">
            {m.actions.map((a) => (
              <button
                key={a.spell_id}
                className={`action el-${a.element}`}
                disabled={busy || !a.available}
                onClick={() => act(a.spell_id)}
                aria-describedby={`act-${a.spell_id}`}
              >
                <span className="action-name">
                  {ELEMENT_ICON[a.element]} {a.name}
                </span>
                <span id={`act-${a.spell_id}`} className="action-meta">
                  {a.mana_cost} mana · {a.effects.map(describeEffect).join(', ')}
                  {a.reason && <em> · {a.reason}</em>}
                </span>
              </button>
            ))}
          </div>
          <button className="btn btn-ghost small" onClick={forfeit} disabled={busy}>
            Forfeit
          </button>
        </section>
      )}

      <section className="card" aria-labelledby="log-title">
        <h2 id="log-title" className="h3">
          Battle log
        </h2>
        <ol className="battle-log" ref={logRef} aria-live="polite" aria-relevant="additions">
          {m.events.map((e) => (
            <li key={e.sequence} className={`log-${e.actor} ${e.turn === lastTurn ? 'latest' : ''}`}>
              <span className="muted small">T{e.turn}</span> {e.message}
            </li>
          ))}
          {m.events.length === 0 && <li className="muted">The battle begins. Make your first move.</li>}
        </ol>
      </section>
    </div>
  );
}
