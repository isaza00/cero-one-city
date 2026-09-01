// "Meet its units": the full army roster of a lineage as little power cards -
// animated sprite, name, and what each one is good at. Special unit first.

import LineageAvatar from "./LineageAvatar";
import { UNIT_POWERS, lineageRoster } from "../game/meta";

export default function UnitRoster({ lineage }: { lineage: string }) {
  return (
    <div className="unit-roster">
      {lineageRoster(lineage).map((unit, i) => {
        const info = UNIT_POWERS[unit];
        if (!info) return null;
        return (
          <div className={`unit-card ${i === 0 ? "special" : ""}`} key={unit}>
            <LineageAvatar lineage={lineage} unit={unit} size={48} />
            <div>
              <strong>{info.label}
                {i === 0 && <span className="badge warn" style={{ marginLeft: 6 }}>special</span>}
              </strong>
              <p className="hint">{info.power}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
