import { createHash } from 'node:crypto';
import { STATUS_RULES, effectivenessBp, type ElementId, type SpellEffect } from '../../content/index.js';

/**
 * Deterministic turn-based combat engine (MVP reference model, §8).
 *
 * Pure functions only: given the immutable match snapshot, the current state and
 * the player's chosen action, `resolveTurn` always produces the same next state
 * and events. Randomness comes from a PRNG seeded by (match seed, turn number),
 * so any battle can be replayed and audited from its seed + action list.
 * The persistence layer (service.ts) is the only thing that knows about the DB,
 * which keeps this engine swappable for an auto-battle or real-time mode later.
 */

export interface CombatSpell {
  id: string;
  name: string;
  element: ElementId;
  manaCost: number;
  cooldown: number;
  effects: SpellEffect[];
  weight?: number;
}

export interface MatchSnapshot {
  contentVersion: string;
  rulesetId: string;
  encounterId: string;
  player: { name: string; element: ElementId; maxHp: number; maxMana: number; speed: number; manaRegen: number; spells: CombatSpell[] };
  enemy: { name: string; element: ElementId; maxHp: number; speed: number; moves: CombatSpell[] };
}

export interface Fighter {
  hp: number;
  mana: number;
  shield: { amount: number; turns: number } | null;
  burn: { perTurn: number; turns: number } | null;
  paralysis: { turns: number } | null;
  paralysisImmunity: number;
  guarding: boolean;
  cooldowns: Record<string, number>;
}

export type Side = 'player' | 'enemy';

export interface BattleState {
  turn: number;
  player: Fighter;
  enemy: Fighter;
  outcome: 'victory' | 'defeat' | null;
}

export interface BattleEvent {
  turn: number;
  actor: Side | 'system';
  kind: 'cast' | 'damage' | 'heal' | 'shield' | 'status' | 'paralysed' | 'burn_tick' | 'expire' | 'immune' | 'guard' | 'outcome';
  message: string;
  data?: Record<string, unknown>;
}

export class IllegalActionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** mulberry32: tiny, fast, good-enough PRNG with a 32-bit state. */
export function seededRng(seed: string, turn: number): () => number {
  let a = createHash('sha256').update(`${seed}:${turn}`).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const freshFighter = (hp: number, mana: number): Fighter => ({
  hp, mana, shield: null, burn: null, paralysis: null, paralysisImmunity: 0, guarding: false, cooldowns: {},
});

export function initialState(snapshot: MatchSnapshot): BattleState {
  return {
    turn: 0,
    player: freshFighter(snapshot.player.maxHp, snapshot.player.maxMana),
    enemy: freshFighter(snapshot.enemy.maxHp, 0),
    outcome: null,
  };
}

/** Which of the player's spells can be cast right now, and why not (for the turn UI). */
export function legalActions(snapshot: MatchSnapshot, state: BattleState) {
  return snapshot.player.spells.map((spell) => {
    let reason: string | null = null;
    if (state.outcome) reason = 'Battle is over';
    else if ((state.player.cooldowns[spell.id] ?? 0) > 0) reason = `Cooling down (${state.player.cooldowns[spell.id]} turns)`;
    else if (state.player.mana < spell.manaCost) reason = 'Not enough mana';
    return { spell_id: spell.id, available: reason === null, reason };
  });
}

const clone = <T>(value: T): T => structuredClone(value);
const roll = (rng: () => number, chanceBp: number) => Math.floor(rng() * 10_000) < chanceBp;

export function resolveTurn(
  snapshot: MatchSnapshot,
  seed: string,
  state: BattleState,
  playerSpellId: string,
): { state: BattleState; events: BattleEvent[] } {
  if (state.outcome) throw new IllegalActionError('BATTLE_OVER', 'The battle is already over');
  const playerSpell = snapshot.player.spells.find((s) => s.id === playerSpellId);
  if (!playerSpell) throw new IllegalActionError('SPELL_NOT_IN_LOADOUT', 'That spell is not in your loadout');
  const legal = legalActions(snapshot, state).find((a) => a.spell_id === playerSpellId);
  if (!legal?.available) throw new IllegalActionError('ACTION_NOT_AVAILABLE', legal?.reason ?? 'Action not available');

  const s = clone(state);
  const turn = s.turn + 1;
  const rng = seededRng(seed, turn);
  const events: BattleEvent[] = [];
  const names: Record<Side, string> = { player: snapshot.player.name, enemy: snapshot.enemy.name };
  const elements: Record<Side, ElementId> = { player: snapshot.player.element, enemy: snapshot.enemy.element };
  const fighter = (side: Side) => s[side];
  const other = (side: Side): Side => (side === 'player' ? 'enemy' : 'player');

  s.player.guarding = false;
  s.enemy.guarding = false;

  const enemyMove = chooseEnemyMove(snapshot, s.enemy, rng);
  // Guard always resolves first so it protects for the whole round; otherwise faster acts first, player wins ties.
  const playerFirst = playerSpell.effects.some((e) => e.type === 'guard') || snapshot.player.speed >= snapshot.enemy.speed;
  const order: [Side, CombatSpell][] = playerFirst
    ? [['player', playerSpell], ['enemy', enemyMove]]
    : [['enemy', enemyMove], ['player', playerSpell]];

  for (const [side, spell] of order) {
    if (fighter('player').hp <= 0 || fighter('enemy').hp <= 0) break;
    const me = fighter(side);
    if (me.paralysis && roll(rng, STATUS_RULES.paralysis.skipChanceBp)) {
      events.push({ turn, actor: side, kind: 'paralysed', message: `${names[side]} is paralysed and cannot act!` });
      continue;
    }
    cast(side, spell);
  }

  // End of round: damage over time, then durations, cooldowns and mana regeneration.
  for (const side of ['player', 'enemy'] as Side[]) {
    const f = fighter(side);
    if (f.hp <= 0) continue;
    if (f.burn) {
      f.hp = Math.max(0, f.hp - f.burn.perTurn);
      events.push({ turn, actor: 'system', kind: 'burn_tick', message: `${names[side]} burns for ${f.burn.perTurn} damage.`, data: { target: side, amount: f.burn.perTurn } });
      if (--f.burn.turns <= 0) f.burn = null;
    }
    if (f.paralysis && --f.paralysis.turns <= 0) {
      f.paralysis = null;
      f.paralysisImmunity = STATUS_RULES.paralysis.immunityTurns + 1;
      events.push({ turn, actor: 'system', kind: 'expire', message: `${names[side]} shakes off the paralysis.` });
    }
    if (f.paralysisImmunity > 0) f.paralysisImmunity--;
    if (f.shield && --f.shield.turns <= 0) f.shield = null;
    for (const id of Object.keys(f.cooldowns)) f.cooldowns[id] = Math.max(0, (f.cooldowns[id] ?? 0) - 1);
  }
  s.player.mana = Math.min(snapshot.player.maxMana, s.player.mana + snapshot.player.manaRegen);

  // An enemy that falls in the same round as the player still counts as a victory.
  if (s.enemy.hp <= 0) s.outcome = 'victory';
  else if (s.player.hp <= 0) s.outcome = 'defeat';
  if (s.outcome) {
    events.push({
      turn, actor: 'system', kind: 'outcome',
      message: s.outcome === 'victory' ? `${snapshot.enemy.name} is defeated!` : `${snapshot.player.name} is defeated...`,
      data: { outcome: s.outcome },
    });
  }
  s.turn = turn;
  return { state: s, events };

  function cast(side: Side, spell: CombatSpell) {
    const me = fighter(side);
    const targetSide = other(side);
    const target = fighter(targetSide);
    me.mana -= side === 'player' ? spell.manaCost : 0;
    if (spell.cooldown > 0) me.cooldowns[spell.id] = spell.cooldown + 1;
    events.push({ turn, actor: side, kind: 'cast', message: `${names[side]} casts ${spell.name}.`, data: { spell_id: spell.id } });

    for (const effect of spell.effects) {
      if (target.hp <= 0) break;
      switch (effect.type) {
        case 'damage': {
          const mult = effectivenessBp(spell.element, elements[targetSide]);
          const variance = 90 + Math.floor(rng() * 21); // 90-110%
          const guard = target.guarding ? 50 : 100;
          let amount = Math.max(1, Math.floor((effect.power * mult * variance * guard) / 100_000_000));
          let absorbed = 0;
          if (target.shield) {
            absorbed = Math.min(target.shield.amount, amount);
            target.shield.amount -= absorbed;
            amount -= absorbed;
            if (target.shield.amount <= 0) target.shield = null;
          }
          target.hp = Math.max(0, target.hp - amount);
          const note = mult > 10_000 ? ' It is super effective!' : mult < 10_000 ? ' It is resisted.' : '';
          const shieldNote = absorbed > 0 ? ` (${absorbed} absorbed by shield)` : '';
          events.push({
            turn, actor: side, kind: 'damage',
            message: `${spell.name} hits ${names[targetSide]} for ${amount} damage${shieldNote}.${note}`,
            data: { target: targetSide, amount, absorbed, effectiveness_bp: mult },
          });
          break;
        }
        case 'heal': {
          const max = side === 'player' ? snapshot.player.maxHp : snapshot.enemy.maxHp;
          const healed = Math.min(effect.power, max - me.hp);
          me.hp += healed;
          events.push({ turn, actor: side, kind: 'heal', message: `${names[side]} recovers ${healed} HP.`, data: { target: side, amount: healed } });
          break;
        }
        case 'shield': {
          // Stacking rule: replace only if stronger.
          if (!me.shield || me.shield.amount < effect.power) {
            me.shield = { amount: effect.power, turns: Math.min(effect.turns, STATUS_RULES.shield.maxTurns) };
          }
          events.push({ turn, actor: side, kind: 'shield', message: `${names[side]} is shielded (${me.shield.amount}).`, data: { target: side, amount: me.shield.amount } });
          break;
        }
        case 'burn': {
          if (!roll(rng, effect.chanceBp)) break;
          // Stacking rule: refresh duration, keep the stronger tick.
          target.burn = {
            perTurn: Math.max(target.burn?.perTurn ?? 0, effect.perTurn),
            turns: Math.min(effect.turns, STATUS_RULES.burn.maxTurns),
          };
          events.push({ turn, actor: side, kind: 'status', message: `${names[targetSide]} is burning!`, data: { target: targetSide, status: 'burn' } });
          break;
        }
        case 'paralysis': {
          if (target.paralysisImmunity > 0) {
            events.push({ turn, actor: side, kind: 'immune', message: `${names[targetSide]} resists paralysis.`, data: { target: targetSide } });
            break;
          }
          if (!roll(rng, effect.chanceBp)) break;
          target.paralysis = { turns: Math.min(effect.turns, STATUS_RULES.paralysis.maxTurns) };
          events.push({ turn, actor: side, kind: 'status', message: `${names[targetSide]} is paralysed!`, data: { target: targetSide, status: 'paralysis' } });
          break;
        }
        case 'guard': {
          me.guarding = true;
          const max = side === 'player' ? snapshot.player.maxMana : 0;
          const restored = Math.min(effect.manaRestore, max - me.mana);
          me.mana += restored;
          events.push({ turn, actor: side, kind: 'guard', message: `${names[side]} braces and recovers ${restored} mana.`, data: { mana: restored } });
          break;
        }
      }
    }
  }
}

function chooseEnemyMove(snapshot: MatchSnapshot, enemy: Fighter, rng: () => number): CombatSpell {
  const ready = snapshot.enemy.moves.filter((m) => (enemy.cooldowns[m.id] ?? 0) === 0);
  const pool = ready.length > 0 ? ready : snapshot.enemy.moves.slice(0, 1);
  const total = pool.reduce((sum, m) => sum + (m.weight ?? 1), 0);
  let pick = rng() * total;
  for (const move of pool) {
    pick -= move.weight ?? 1;
    if (pick < 0) return move;
  }
  return pool[pool.length - 1]!;
}

/** Re-runs a battle from its seed and action list; used to audit outcomes and in tests. */
export function replay(snapshot: MatchSnapshot, seed: string, actions: string[]): { state: BattleState; events: BattleEvent[] } {
  let state = initialState(snapshot);
  const events: BattleEvent[] = [];
  for (const action of actions) {
    const result = resolveTurn(snapshot, seed, state, action);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}
