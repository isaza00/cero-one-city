// The control mode: how much you steer your agent during ONE match. Picked
// every time a match is started or joined (never changed mid-match) and
// remembered per browser so the next match starts the same way.

import { useState } from "react";
import type { ControlMode } from "../api/types";

export const MODES: { id: ControlMode; label: string; tagline: string; detail: string }[] = [
  { id: "manual", label: "Manual", tagline: "it only does what you tell it in the chat",
    detail: "You are the player, the agent is your hands: it makes no decisions of its "
          + "own and stands still until your first message. One message per turn, "
          + "every turn, and an order stays in force until you change it." },
  { id: "copilot", label: "Copilot", tagline: "it plays by itself, you can give orders",
    detail: "Between your messages it keeps playing its own game; a message overrides "
          + "its plan from the next turn on. One message per turn, up to 20 per match." },
  { id: "autonomous", label: "Autonomous", tagline: "it plays alone, chat closed",
    detail: "Pick this to just watch: no messages can be sent for the whole match, "
          + "and the agent relies only on its personality and memory." },
];

export const MODE_LABEL: Record<ControlMode, string> = {
  manual: "Manual", copilot: "Copilot", autonomous: "Autonomous",
};

const STORAGE_KEY = "cero.control_mode";

function isMode(value: unknown): value is ControlMode {
  return value === "manual" || value === "copilot" || value === "autonomous";
}

/** The picked mode, remembered in localStorage (default: copilot). */
export function useControlMode(): [ControlMode, (m: ControlMode) => void] {
  const [mode, setModeState] = useState<ControlMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (isMode(saved)) return saved;
    } catch { /* storage unavailable: session default */ }
    return "copilot";
  });
  const setMode = (m: ControlMode) => {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch { /* ignore */ }
  };
  return [mode, setMode];
}

export default function ModePicker({ value, onChange, compact }: {
  value: ControlMode; onChange: (m: ControlMode) => void; compact?: boolean;
}) {
  const current = MODES.find((m) => m.id === value) ?? MODES[1];
  return (
    <div className={`mode-picker${compact ? " compact" : ""}`}>
      <div className="mode-options" role="radiogroup" aria-label="control mode">
        {MODES.map((m) => (
          <button type="button" key={m.id} role="radio" aria-checked={value === m.id}
                  className={`mode-opt ${m.id}${value === m.id ? " on" : ""}`}
                  onClick={() => onChange(m.id)}>
            <span className="mode-name">{m.label}</span>
            <span className="mode-tagline">{m.tagline}</span>
          </button>
        ))}
      </div>
      {!compact && <p className="mode-detail">{current.detail}</p>}
    </div>
  );
}
