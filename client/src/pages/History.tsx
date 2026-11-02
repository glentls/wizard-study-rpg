import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import type { FocusSession, LedgerEntry, StudySummary } from '../api/types';
import { Alert, Loading, PageHeader, Stat } from '../components/ui';
import { CURRENCY_LABEL, REASON_LABEL, dateTime, humanMinutes, minutes, shortDay } from '../lib/format';
import { useLoad } from '../lib/useLoad';

const STATE_LABEL: Record<string, string> = {
  ACTIVE: 'In progress',
  COMPLETED: 'Completed',
  INTERRUPTED: 'Interrupted',
  INVALIDATED: 'Invalidated',
};

export function History() {
  const summary = useLoad(() => api.get<StudySummary>('/v1/me/summary'));
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [sessionCursor, setSessionCursor] = useState<string | null | undefined>(undefined);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerCursor, setLedgerCursor] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = async (cursor?: string) => {
    try {
      const res = await api.get<{ sessions: FocusSession[]; next_cursor: string | null }>(
        `/v1/focus-sessions?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      setSessions((prev) => (cursor ? [...prev, ...res.sessions] : res.sessions));
      setSessionCursor(res.next_cursor);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const loadLedger = async (cursor?: string) => {
    try {
      const res = await api.get<{ entries: LedgerEntry[]; next_cursor: string | null }>(`/v1/ledger?limit=15${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      setLedger((prev) => (cursor ? [...prev, ...res.entries] : res.entries));
      setLedgerCursor(res.next_cursor);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  useEffect(() => {
    void loadSessions();
    void loadLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportData = async () => {
    try {
      const data = await api.get<unknown>('/v1/me/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `wizard-study-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const s = summary.data;
  return (
    <div className="stack-lg">
      <PageHeader title="History" subtitle="Your focus sessions, rewards and study trends.">
        <button className="btn" onClick={exportData}>
          Export my data
        </button>
      </PageHeader>
      {error && <Alert kind="error">{error}</Alert>}

      {s ? (
        <div className="stats-row">
          <Stat label="This week" value={humanMinutes(s.week_focus_minutes)} />
          <Stat label="Study days" value={`${s.week_study_days}/7`} />
          <Stat label="Streak" value={`${s.current_streak_days} days`} />
          <Stat label="All sessions" value={s.total_sessions} />
        </div>
      ) : (
        <Loading />
      )}

      {s && (
        <section className="card" aria-labelledby="trend-title">
          <h2 id="trend-title" className="h3">
            Daily focus, last 7 days
          </h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Focused</th>
                <th scope="col">Rewarded</th>
                <th scope="col">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {s.week.map((d) => (
                <tr key={d.study_day}>
                  <th scope="row">
                    {shortDay(d.study_day)} <span className="muted small">{d.study_day}</span>
                  </th>
                  <td>{d.focus_minutes} min</td>
                  <td>{d.credited_minutes} min</td>
                  <td>{d.sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card" aria-labelledby="sessions-title">
        <h2 id="sessions-title" className="h3">
          Focus sessions
        </h2>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Started</th>
                <th scope="col">Duration</th>
                <th scope="col">Status</th>
                <th scope="col">Multiplier</th>
                <th scope="col">Points</th>
                <th scope="col">Objective</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((x) => (
                <tr key={x.id}>
                  <td>{dateTime(x.started_at)}</td>
                  <td>{minutes(x.validated_seconds ?? x.elapsed_seconds)} min</td>
                  <td>{STATE_LABEL[x.state] ?? x.state}</td>
                  <td>{x.award ? `×${x.award.multiplier.toFixed(2)}` : '–'}</td>
                  <td>{x.award ? x.award.awarded_points : '–'}</td>
                  <td className="muted">{x.objective ?? ''}</td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No sessions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {sessionCursor && (
          <button className="btn btn-ghost" onClick={() => loadSessions(sessionCursor)}>
            Load more
          </button>
        )}
      </section>

      <section className="card" aria-labelledby="ledger-title">
        <h2 id="ledger-title" className="h3">
          Reward ledger
        </h2>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">What</th>
                <th scope="col">Change</th>
                <th scope="col">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id}>
                  <td>{dateTime(e.created_at)}</td>
                  <td>{REASON_LABEL[e.reason] ?? e.reason}</td>
                  <td className={e.delta > 0 ? 'delta-plus' : 'delta-minus'}>
                    {e.delta > 0 ? '+' : ''}
                    {e.delta} {CURRENCY_LABEL[e.currency]}
                  </td>
                  <td>
                    {e.balance_after} {CURRENCY_LABEL[e.currency]}
                  </td>
                </tr>
              ))}
              {ledger.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No transactions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {ledgerCursor && (
          <button className="btn btn-ghost" onClick={() => loadLedger(ledgerCursor)}>
            Load more
          </button>
        )}
      </section>
    </div>
  );
}
