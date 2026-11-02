import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, errorMessage } from '../api/client';
import { useAuth, useMe } from '../auth/AuthContext';
import { Alert, Meter, PageHeader, Stat } from '../components/ui';
import { ELEMENT_ICON } from '../lib/format';

export function Wizard() {
  const me = useMe();
  const { reload } = useAuth();
  const wizard = me.wizard;
  const [slots, setSlots] = useState(wizard.loadout.slots);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setSlots(wizard.loadout.slots), [wizard.loadout.slots]);

  const rank = wizard.rank;
  const dirty = slots.join('|') !== wizard.loadout.slots.join('|');

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/v1/wizard/loadout', { spell_ids: slots.filter((s): s is string => Boolean(s)), revision: wizard.loadout.revision });
      await reload();
      setNotice({ kind: 'success', text: 'Loadout saved.' });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'LOADOUT_REVISION_CONFLICT') {
        await reload();
        setNotice({ kind: 'error', text: 'Your loadout was changed on another device. We loaded the latest version.' });
      } else setNotice({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const setSlot = (index: number, value: string) => {
    setSlots((current) => current.map((s, i) => (i === index ? value || null : s === value ? null : s)));
  };

  return (
    <div className="stack-lg">
      <PageHeader
        title={wizard.name}
        subtitle={
          <>
            {ELEMENT_ICON[wizard.element]} {wizard.element_name} wizard · {rank.title}
          </>
        }
      />
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}

      <div className="stats-row">
        <Stat label="Health" value={wizard.stats.max_hp} hint="Grows with rank" />
        <Stat label="Mana" value={wizard.stats.max_mana} hint={`Mana level ${wizard.stats.mana_level}`} />
        <Stat label="Mana regen" value={`+${wizard.stats.mana_regen}/turn`} />
        <Stat label="Research points" value={wizard.balances.RESEARCH_POINTS} />
      </div>

      <section className="card" aria-labelledby="rank-title">
        <h2 id="rank-title" className="h3">
          Combat rank {rank.level}: {rank.title}
        </h2>
        <p className="muted small">Rank comes from battle experience only. It is separate from your study progress.</p>
        {rank.nextAt !== null ? (
          <Meter label="Experience to next rank" value={rank.xp} max={rank.nextAt} tone="accent" />
        ) : (
          <p>Maximum rank reached ({rank.xp} XP).</p>
        )}
      </section>

      <section className="card stack" aria-labelledby="loadout-title">
        <h2 id="loadout-title" className="h3">
          Spell loadout
        </h2>
        <p className="muted small">Arcane Bolt and Guard are always available. Choose up to {slots.length} researched spells to bring into battle.</p>
        {wizard.unlocked_spells.length === 0 ? (
          <Alert kind="info">
            You have not unlocked any spells yet. <Link to="/research">Visit Research</Link> after a focus session.
          </Alert>
        ) : (
          <div className="loadout-grid">
            {slots.map((spellId, i) => (
              <label key={i} className="field">
                <span>Slot {i + 1}</span>
                <select value={spellId ?? ''} onChange={(e) => setSlot(i, e.target.value)}>
                  <option value="">Empty</option>
                  {wizard.unlocked_spells.map((s) => (
                    <option key={s.id} value={s.id}>
                      {ELEMENT_ICON[s.element]} {s.name} (lv {s.level})
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
        <div>
          <button className="btn btn-primary" disabled={!dirty || busy} onClick={save}>
            Save loadout
          </button>
        </div>
      </section>

      <section className="card" aria-labelledby="inventory-title">
        <h2 id="inventory-title" className="h3">
          Inventory
        </h2>
        <p className="muted">Staves and equipment arrive in a later release. Cosmetics will never affect combat or study rewards.</p>
      </section>
    </div>
  );
}
