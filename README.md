# Wizard Study (MVP)

A study timer dressed up as a cozy wizard game. You study for real. Your wizard brews a potion while the sand runs out. Afterwards you collect XP and gold and spend them on spells in the library.

This MVP follows the design meeting of 5 Nov 2026: **the study loop plus the library**. It is single player, saves locally in the browser, and has no accounts and no server.

## Run it

Needs Node 20 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # game-rule tests (timer, rewards, investing, saves)
npm run build      # static build in client/dist, which you can host anywhere
```

**Demo tip:** open ⚙️ Settings and turn on **Demo speed**. One minute then passes every second, so a full 10-minute session, its rewards and the break can be shown in under 30 seconds.

## What's in the MVP

| Meeting decision | How it works in the game |
|---|---|
| Start screen shows the island zoomed out with the title. Tap anywhere to zoom in | `IslandScene`. Tapping anywhere zooms the camera into the island |
| First launch: "You're a wizard, ___" name pop-up | `NamePrompt`. The name can be changed later in Profile |
| Island has the **Laboratory** (study) and the **Library** (spells). The portal is disabled, "under construction" | The portal is greyed out with a sign. Tapping it shows a toast |
| Level and gold at the top of every page **except the study screen** (focus mode) | `Hud` shows level + XP bar, gold, XP to invest, a break timer and the profile button. It is hidden while studying |
| Lab: circular table with a giant hourglass, a potion station and an enchantment station. The character idles and looks around | `LabScene` |
| "Start session" opens a pop-up with a **study-time slider, max 1.5 hours** | `SessionSetup`: 5–90 min in 5-minute steps. It remembers your last choice |
| **No decisions before studying.** Study first, choose upgrades afterwards | The pop-up has only the slider and Start. Rewards are allocated later in the Library |
| On start, the **hourglass flips** and the sand falls for the whole session while the wizard works at a station | Countdown on top, nothing else on screen. "End session" is tucked at the bottom |
| When it ends: celebrate, a **potion pops out**, then a summary with time studied, **XP and gold** | The potion type depends on session length. The rewards card shows any level up |
| **10-minute break that you can skip**, like a workout app | The wizard sips tea. Skip it, start the next session, or go spend XP while the break timer runs in the HUD |
| Library: tree in the middle, shelves around it: **Spell Scrolls**, **Mana Scrolls**, and one **unavailable** | Two shelves open. A third, chained shelf is "Sealed" |
| Scroll unrolls into a menu. **Two elements to start**, the rest faded | Fire and Water are playable. Earth, Air, Lightning and Shadow are shown faded and sealed |
| Tap a spell: it zooms in with **name, level and XP bar** | `SpellCard` |
| **"Invest 1"** and **"Invest max"** (all your points, or just enough to reach the next level). After a level up the bar resets to empty so you can keep pressing | Exactly that. Each level costs 1.5× more than the last, up to level 10 |
| Back folds the scroll up. Back again returns to the island | Each Back reverses one step. Esc works too |
| Profile with stats ("how many hours"), change nickname, settings | Hours studied, sessions, streak, longest session, last 7 days, potion collection, recent sessions, sound / notifications / demo speed |
| **Save locally for now.** No database or auth until multiplayer | Saved in `localStorage`. **Download save / Load save** in Settings is a manual backup, so clearing the browser doesn't have to wipe progress |

**Not in the MVP** (the meeting moved these to later): combat (PvE/PvP), multiplayer and shared tables, accounts and cloud saves, skins and trading, and a use for gold. Gold is collected now so it can buy cosmetics later.

## Game rules

All numbers live in [client/src/game/config.ts](client/src/game/config.ts) and [client/src/game/content.ts](client/src/game/content.ts).

- **XP:** 1 per minute studied, plus a **20% focus bonus** for finishing the session you planned.
- **Gold:** 1 per 2 minutes, plus 5 for finishing.
- **Ending early:** you keep XP and gold for every full minute, but get no bonus and no potion.
- **Wizard level** comes from lifetime XP. Spending XP in the library never lowers it. Going from level L to L+1 needs 50 + 25×(L−1) XP.
- **Spells:** within each element, a spell unlocks once the previous one is learned (level 1).
- **Potions:** under 25 min → Minor Focus Draught, 25+ → Focus Elixir, 60+ → Elixir of Clarity, 90 → Grand Elixir of Wisdom.
- **Timer:** based on timestamps, not ticks. Refreshing, closing the tab or sleeping the laptop never loses time. A session that ended while the app was closed is credited at its scheduled end, and the rewards are waiting when you come back.

| Session | XP | Gold | Potion |
|---|---|---|---|
| 25 min | 30 | 17 | Focus Elixir |
| 60 min | 72 | 35 | Elixir of Clarity |
| 90 min | 108 | 50 | Grand Elixir of Wisdom |

## Code map

```
client/src/
  game/            pure game logic (no React): config, content, progression, state reducer, storage, sounds
  scenes/          IslandScene (title + hub), LabScene (study loop), LibraryScene (scrolls), ProfileScene
  components/      Hud, Hourglass, WizardSprite, SessionSetup, ResultCard, SpellCard, NamePrompt, ui
  App.tsx          scene director with the zoom-in/zoom-out camera transitions
client/test/       vitest tests for the game rules
```

**For the art pass:** every scene is inline SVG made of simple, grouped shapes, and every animation is a CSS class in [client/src/styles.css](client/src/styles.css) (for example `.wizard--idle`, `.wizard--work`, `.hourglass--flip`, `.potion-pop`, `.scroll`). Swap a group for a drawn sprite or image and the behaviour stays the same. Pixel art or hand-drawn PNGs can drop in with `<image href=...>` at the same coordinates.

## The `server/` folder

`server/` holds an earlier prototype: an Express + SQLite backend with accounts, server-side timers and combat. The meeting decided the MVP doesn't need a backend yet, so nothing uses it now and the root scripts only run the client. It is kept as reference for when multiplayer, cloud saves and battles come in (`npm run legacy:server:test` still runs its tests).
