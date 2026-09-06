import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { initSpritePack } from "./pixi/spritepack";
import { initTerrainProps } from "./pixi/terrainprops";

// Load the pixel-art sprite pack; falls back to procedural art until ready.
initSpritePack().catch((e) => console.warn("sprite pack not loaded:", e));
initTerrainProps().catch((e) => console.warn("terrain props not loaded:", e));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
