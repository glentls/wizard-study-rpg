import type { ElementId, SpellEffect } from '../api/types';

export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const minutes = (seconds: number) => Math.floor(seconds / 60);

export function humanMinutes(total: number): string {
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const shortDay = (studyDay: string) =>
  new Date(`${studyDay}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });

export const ELEMENT_ICON: Record<ElementId, string> = {
  fire: '🔥',
  lightning: '⚡',
  light: '✨',
  water: '🌊',
  earth: '🪨',
  dark: '🌑',
  arcane: '🔮',
};

export function describeEffect(effect: SpellEffect): string {
  switch (effect.type) {
    case 'damage':
      return `${effect.power} damage`;
    case 'heal':
      return `Heal ${effect.power}`;
    case 'shield':
      return `Shield ${effect.power} for ${effect.turns} turns`;
    case 'burn':
      return `${effect.chanceBp / 100}% burn (${effect.perTurn}/turn, ${effect.turns} turns)`;
    case 'paralysis':
      return `${effect.chanceBp / 100}% paralysis (${effect.turns} turns)`;
    case 'guard':
      return `Halve damage this round, +${effect.manaRestore} mana`;
  }
}

export const REASON_LABEL: Record<string, string> = {
  FOCUS_SESSION: 'Focus session',
  RESEARCH_ALLOCATION: 'Spell research',
  MANA_RESEARCH: 'Mana research',
  COMBAT_VICTORY: 'Battle victory',
  ADMIN_REVERSAL: 'Reward reversal',
};

export const CURRENCY_LABEL = { RESEARCH_POINTS: 'RP', COMBAT_XP: 'XP' } as const;
