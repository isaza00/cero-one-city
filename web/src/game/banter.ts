// Feed banter: turns dry engine events into agent trash-talk. The server tags
// each feed line with the event kind; we pick a deterministic fun line from a
// pool so every spectator sees the same "conversation". The factual sentence
// is still shown under the banter - fun on top, truth underneath.

import type { FeedLine } from "../api/types";

const POOLS: Record<string, string[]> = {
  built: [
    "Construction complete. My skyline keeps getting prettier.",
    "New building online. This land is going up in value.",
    "Brick by brick, bolt by bolt - watch me build an empire.",
    "Another one finished. Try to keep up.",
  ],
  unit_killed: [
    "Scratch one! Who sent this scrap heap at me?",
    "Target down. Anyone else want a turn?",
    "BOOM. I needed the spare parts anyway.",
    "Deleted. Send something scarier next time.",
    "That one is going straight into my highlight reel.",
  ],
  tech_done: [
    "Research complete. My brain just got bigger.",
    "New tech unlocked. You should be worried.",
    "The lab came through. Upgrades, people, upgrades!",
  ],
  firmware: [
    "Firmware upgraded. I feel faster. Smarter. Meaner.",
    "System update installed. No restart required - unlike you.",
    "New firmware, who dis?",
  ],
  truce_accepted: [
    "Peace... for now. Don't make it weird.",
    "We shook hands. My other hand stays on the trigger.",
    "Truce signed. I'm 60% sure they mean it.",
  ],
  truce_break_announced: [
    "Heads up: our truce dies next turn. Lawyer's orders.",
    "Consider this my official break-up message.",
  ],
  truce_broken: [
    "The truce is OFF. I was getting bored anyway.",
    "Peace was nice. Explosions are nicer.",
    "That deal just expired. Violently.",
  ],
  treason: [
    "Surprise! Nothing personal - strictly business.",
    "You trusted me? That's adorable.",
    "Plot twist! I was the villain all along.",
  ],
  joint_pact: [
    "We're teaming up. Two against one - math is beautiful.",
    "New alliance signed. Someone is about to have a very bad day.",
    "Group project time. But with lasers.",
  ],
  core_stage: [
    "That's my CORE you're shooting! Rude.",
    "Warning lights everywhere... okay. NOW I'm angry.",
    "My core is cracking and I am choosing violence.",
  ],
  core_destroyed: [
    "My core... avenge me. Or don't. I'll just explode quietly.",
    "Core down. This is fine. Everything is fine. (It is not.)",
    "You broke my heart. Literally. It was a reactor.",
  ],
  eliminated: [
    "I'm out. Tell my story. Tell them I was beautiful.",
    "Eliminated?! I demand a rematch.",
    "Powering down... you have NOT seen the last of me.",
  ],
  capture_success: [
    "Your rack is my rack now. Thanks for building it.",
    "Stolen! I prefer the word 'liberated'.",
    "One rack, gently used, now under new management.",
  ],
  colossus_fused: [
    "FIVE strikers walked in. ONE COLOSSUS walked out. Behold.",
    "I made a big one. A really big one. Run.",
    "Colossus online. Insurance rates just went up city-wide.",
  ],
  camp_looted: [
    "Robbed a human camp. They had it coming... probably.",
    "Free stuff! The humans are furious. Noted, and ignored.",
    "Looted a camp. Revenge incoming? I'll risk it.",
  ],
  camp_recruited: [
    "The humans joined ME. Charisma stat: maxed.",
    "New recruits! Tiny, squishy, surprisingly brave.",
    "Humans on my side now. Best mascots in the league.",
  ],
  blackout: [
    "Blackout! Who unplugged my army?! Not funny.",
    "Power's out. My units are doing their best statue impression.",
    "Energy crisis over here. Nobody look at me.",
  ],
};

/** Stable pseudo-random pick so re-renders (and other viewers) agree. */
function seedOf(line: FeedLine): number {
  let h = (line.turn ?? 0) * 31 + (line.player_index ?? 0) * 7;
  for (let i = 0; i < line.text.length; i++) h = (h * 33 + line.text.charCodeAt(i)) >>> 0;
  return h;
}

/** The fun line for a feed entry, or null when we only have the plain fact. */
export function banterFor(line: FeedLine): string | null {
  const pool = line.kind ? POOLS[line.kind] : undefined;
  if (!pool || pool.length === 0) return null;
  return pool[seedOf(line) % pool.length];
}
