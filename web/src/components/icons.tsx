// Tiny inline SVG icons for the HUD - crisp at 12-14px, tinted via
// currentColor. Deliberately not emojis.

const S = { width: 13, height: 13, viewBox: "0 0 16 16", fill: "currentColor" };

export const EnergyIcon = () => (
  <svg {...S} aria-label="energy"><path d="M9 0 3 9h3.5L5.5 16 13 6H8.8L11 0z" /></svg>
);

export const MetalIcon = () => (
  <svg {...S} aria-label="metal">
    <path d="M2 13.5 8.5 7l1.6 1.6L3.6 15 2 15z" />
    <path d="M8 2c3-1.6 6 .2 7 3l-2.4-.7L10 6.7 9 5.6l1.4-2.4C9.6 2.7 8.8 2.3 8 2z" />
  </svg>
);

export const UnitsIcon = () => (
  <svg {...S} aria-label="robots">
    <rect x="3" y="4" width="10" height="8" rx="1.5" />
    <rect x="5.5" y="6.5" width="2" height="2" fill="#0a0e13" />
    <rect x="8.5" y="6.5" width="2" height="2" fill="#0a0e13" />
    <rect x="7" y="1" width="2" height="2.5" />
    <rect x="4.5" y="13" width="2.5" height="2" />
    <rect x="9" y="13" width="2.5" height="2" />
  </svg>
);

export const BuildingsIcon = () => (
  <svg {...S} aria-label="buildings">
    <path d="M1 15V8l4-2v2l4-2v2l4-2v9z" />
    <rect x="3" y="10" width="2" height="2" fill="#0a0e13" />
    <rect x="7" y="10" width="2" height="2" fill="#0a0e13" />
    <rect x="11" y="10" width="2" height="2" fill="#0a0e13" />
  </svg>
);

export const DamageIcon = () => (
  <svg {...S} aria-label="damage">
    <path d="M8 0l1.8 4.6L14 3l-2.4 3.9L16 8l-4.4 1.1L14 13l-4.2-1.6L8 16l-1.8-4.6L2 13l2.4-3.9L0 8l4.4-1.1L2 3l4.2 1.6z" />
  </svg>
);

export const ClockIcon = () => (
  <svg {...S} aria-label="time">
    <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M8 4v4.5l3 1.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);
