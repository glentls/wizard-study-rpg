import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { CurrentFocus, EncounterList, LedgerEntry, ResearchTree, SpellNode, StudySummary } from '../api/types';
import { useMe } from '../auth/AuthContext';
import { Alert, Loading, Meter, PageHeader, Stat } from '../components/ui';
import { ELEMENT_ICON, REASON_LABEL, clock, dateTime, shortDay } from '../lib/format';
import { useLoad } from '../lib/useLoad';

/** Picks the most useful next research step: finish the starter element first, then the cheapest available spell. */
function nextObjective(tree: ResearchTree): SpellNode | null {
  const order = [...tree.elements].sort((a, b) => Number(b.is_starter) - Number(a.is_starter));
  const candidates = order.flatMap((e) => e.spells).filter((s) => s.state !== 'LOCKED' && s.state !== 'MAXED');
  const notUnlocked = candidates.filter((s) => s.level === 0);
  return notUnlocked[0] ?? candidates.sort((a, b) => (a.next_cost ?? 0) - (b.next_cost ?? 0))[0] ?? null;
}

export function Dashboard() {
  const me = useMe();
  const data = useLoad(async () => {
    const [focus, summary, tree, ledger, adventures] = await Promise.all([
      api.get<CurrentFocus>('/v1/focus-sessions/current'),
      api.get<StudySummary>('/v1/me/summary'),
      api.get<ResearchTree>('/v1/research/tree'),
      api.get<{ entries: LedgerEntry[] }>('/v1/ledger?limit=5'),
      api.get<EncounterList>('/v1/encounters'),
    ]);
    return { focus, summary, tree, ledger, adventures };
  });

  if (!data.data) return data.error ? <Alert kind="error">{data.error}</Alert> : <Loading />;
  const { focus, summary, tree, ledger, adventures } = data.data;
  const wizard = me.wizard;
  const objective = nextObjective(tree);
  const maxWeek = Math.max(30, ...summary.week.map((d) => d.focus_minutes));
  const wonTutorial = adventures.encounters.some((e) => e.tutorial && e.victories > 0);

  return (
    <div className="stack-lg">
      <PageHeader
        title={`Welcome back, ${wizard.name}`}
        subtitle={
          <>
            {ELEMENT_ICON[wizard.element]} {wizard.element_name} · {wizard.rank.title} (rank {wizard.rank.level})
            {me.preferences.learningGoal && <> · Studying for: {me.preferences.learningGoal}</>}
          </>
        }
      />
      {!me.account.email_verified && (
        <Alert kind="info">Verify your email to unlock social features when they arrive. Check Settings to resend the link.</Alert>
      )}

      <section className="card focus-cta" aria-labelledby="cta-title">
        <h2 id="cta-title" className="visually-hidden">
          Focus
        </h2>
        {focus.active ? (
          <>
            <p className="lead">A focus session is running ({clock(focus.active.elapsed_seconds)} so far).</p>
            <Link to="/focus" className="btn btn-primary btn-large">
              Return to session
            </Link>
          </>
        ) : focus.break.break_required ? (
          <>
            <p className="lead">On a well-earned break. Back in {Math.ceil(focus.break.break_remaining_seconds / 60)} minutes.</p>
            <Link to="/focus" className="btn btn-large">
              View break timer
            </Link>
          </>
        ) : (
          <>
            <p className="lead">Ready when you are. Every focused minute becomes research.</p>
            <Link to="/focus" className="btn btn-primary btn-large">
              Start focusing
            </Link>
          </>
        )}
      </section>

      <div className="stats-row">
        <Stat label="Research points" value={me.balances.RESEARCH_POINTS} />
        <Stat label="Focused today" value={`${focus.today.focus_minutes} min`} hint={`${focus.today.daily_cap_remaining_minutes} rewarded min left`} />
        <Stat label="This week" value={`${summary.week_focus_minutes} min`} hint={`${summary.week_study_days} of 7 days`} />
        <Stat label="Streak" value={`${summary.current_streak_days} day${summary.current_streak_days === 1 ? '' : 's'}`} hint="Missing a day never costs progress" />
      </div>

      <div className="grid-2">
        <section className="card" aria-labelledby="next-title">
          <h2 id="next-title" className="h3">
            Next objective
          </h2>
          {!wonTutorial && wizard.unlocked_spells.length > 0 ? (
            <>
              <p>Your first spell is ready. Try it in the tutorial battle.</p>
              <Link to="/adventure" className="btn">
                Fight the Training Golem
              </Link>
            </>
          ) : objective ? (
            <>
              <p>
                <strong>{objective.name}</strong> {objective.level > 0 ? `→ level ${objective.next_level}` : '(unlock)'}
              </p>
              <Meter label="Research" value={objective.progress} max={objective.next_cost ?? 0} tone="gold" />
              {objective.milestone && !objective.milestone.satisfied && (
                <p className="muted small">Also needs one uninterrupted {objective.milestone.minutes}-minute session.</p>
              )}
              <Link to="/research" className="btn">
                Open research
              </Link>
            </>
          ) : (
            <p className="muted">Everything available is researched. Impressive!</p>
          )}
        </section>

        <section className="card" aria-labelledby="week-title">
          <h2 id="week-title" className="h3">
            Last 7 days
          </h2>
          <div className="bars" aria-hidden="true">
            {summary.week.map((d) => (
              <div key={d.study_day} className="bar-col">
                <div className="bar" style={{ height: `${(d.focus_minutes / maxWeek) * 100}%` }} />
                <span className="bar-label">{shortDay(d.study_day)}</span>
              </div>
            ))}
          </div>
          <table className="visually-hidden">
            <caption>Focus minutes per day</caption>
            <tbody>
              {summary.week.map((d) => (
                <tr key={d.study_day}>
                  <th scope="row">{d.study_day}</th>
                  <td>{d.focus_minutes} minutes</td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.daily_goal_minutes && (
            <Meter label="Today's goal" value={summary.week[6]?.focus_minutes ?? 0} max={summary.daily_goal_minutes} tone="accent" />
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="recent-title">
        <h2 id="recent-title" className="h3">
          Recent rewards
        </h2>
        {ledger.entries.length === 0 ? (
          <p className="muted">Nothing yet. Your first session will show up here.</p>
        ) : (
          <ul className="ledger-list">
            {ledger.entries.map((e) => (
              <li key={e.id}>
                <span>{REASON_LABEL[e.reason] ?? e.reason}</span>
                <span className="muted small">{dateTime(e.created_at)}</span>
                <span className={e.delta > 0 ? 'delta-plus' : 'delta-minus'}>
                  {e.delta > 0 ? '+' : ''}
                  {e.delta} {e.currency === 'RESEARCH_POINTS' ? 'RP' : 'XP'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
