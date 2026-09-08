// React wrapper owning a MapRenderer lifecycle. Two modes:
//  - fixed square (sizePx): whole map fitted, e.g. the replay screen;
//  - fill: the canvas takes the host's full rectangle (any aspect ratio),
//    starts zoomed to COVER it, and the viewer drags to pan / wheels to zoom.
// Extras: click-to-select entities (onSelect) and a controller handle the
// minimap uses to read the camera and move it.

import { MutableRefObject, useEffect, useRef, useState } from "react";
import type { GameState } from "../api/types";
import { MapRenderer } from "./MapRenderer";
import type { WorldRenderer } from "../three/WorldRenderer";

export interface MapController {
  getViewFrac(): { x: number; y: number; w: number; h: number } | null;
  centerOnFrac(fx: number, fy: number): void;
  getViewTileQuad(): { tx: number; ty: number }[] | null;
  centerOnTile(tx: number, ty: number): void;
  select(id: number | null): void;
  flashOrder(playerIndex: number, groups: {
    actor_ids?: number[];
    target?: { id?: number; x?: number; y?: number; kind?: string } | null;
    action?: string;
  }[]): void;
}

export default function MapView({ state, perspective = null, sizePx = 640, fill = false,
                                  onSelect, controller, worldSeed }: {
  state: GameState | null;
  perspective?: number | null;
  sizePx?: number;
  fill?: boolean;
  worldSeed?: number;
  onSelect?: (id: number | null) => void;
  controller?: MutableRefObject<MapController | null>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer | WorldRenderer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState(() => new URLSearchParams(window.location.search).get("renderer") === "2d" ? "2d" : "3d");
  const [loading, setLoading] = useState(true);
  const readyRef = useRef<Promise<void> | null>(null);
  const matchKey = window.location.pathname.match(/\/matches\/([^/]+)/)?.[1] ?? "preview";
  const visualSeed = worldSeed ?? Array.from(matchKey).reduce((seed, letter) => Math.imul(seed ^ letter.charCodeAt(0), 16777619), 2166136261) >>> 0;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    let renderer: MapRenderer | WorldRenderer | null = null;
    let cancelled = false;
    setError(null);
    setLoading(true);
    if (controller) {
      controller.current = {
        getViewFrac: () => rendererRef.current?.getViewFrac() ?? null,
        centerOnFrac: (fx, fy) => rendererRef.current?.centerOnFrac(fx, fy),
        getViewTileQuad: () => rendererRef.current?.getViewTileQuad() ?? null,
        centerOnTile: (tx, ty) => rendererRef.current?.centerOnTile(tx, ty),
        select: (id) => rendererRef.current?.select(id),
        flashOrder: (p, groups) => rendererRef.current?.flashOrder(
          p, groups.map((g) => ({ ...g, target: g.target ?? undefined }))),
      };
    }
    const host = hostRef.current;
    let ro: ResizeObserver | null = null;
    readyRef.current = (async () => {
      if (!host) return;
      const Renderer = mode === "3d"
        ? (await import("../three/WorldRenderer")).WorldRenderer : MapRenderer;
      if (cancelled) return;
      renderer = new Renderer();
      renderer.onSelect = (id) => onSelectRef.current?.(id);
      rendererRef.current = renderer;
      await renderer.init(host, fill ? Math.floor(host.clientWidth) || 800 : sizePx,
        fill ? Math.floor(host.clientHeight) || 600 : sizePx, fill);
      if (cancelled) return;
      setLoading(false);
      if (fill) {
        const resize = () => {
          if (cancelled) return;
          const width = Math.floor(host.clientWidth);
          const height = Math.floor(host.clientHeight);
          if (width > 0 && height > 0) renderer?.resizeView(width, height);
        };
        resize();
        ro = new ResizeObserver(() => {
          resize();
        });
        ro.observe(host);
      }
    })().catch((cause: unknown) => {
      if (cancelled) return;
      renderer?.destroy();
      rendererRef.current = null;
      console.error("Battlefield initialization failed", cause);
      setLoading(false);
      setError("The 3D renderer could not start. Choose Classic 2D to continue on this device.");
    });
    return () => {
      cancelled = true;
      ro?.disconnect();
      if (controller) controller.current = null;
      renderer?.destroy();
      rendererRef.current = null;
    };
  }, [sizePx, fill, controller, mode]);

  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    readyRef.current?.then(() => {
      if (cancelled) return;
      const renderer = rendererRef.current;
      if (renderer && "setWorldSeed" in renderer) renderer.setWorldSeed(visualSeed);
      renderer?.render(state, perspective);
    });
    return () => { cancelled = true; };
  }, [state, perspective, sizePx, fill, controller, mode, visualSeed]);

  return <div className={`map-host${fill ? " map-host-fill" : ""}`}
              style={fill ? undefined : { width: sizePx, height: sizePx }}>
    <div ref={hostRef} className="map-surface" />
    <div className="world-toolbar">
      <span className="world-indicator" />
      <span>{mode === "3d" ? "WORLD VIEW / 3D" : "TACTICAL / 2D"}</span>
      {mode === "3d" && <>
        <button type="button" aria-label="Zoom in" onClick={() => {
          const renderer = rendererRef.current;
          if (renderer && "zoomBy" in renderer) renderer.zoomBy(0.8);
        }}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => {
          const renderer = rendererRef.current;
          if (renderer && "zoomBy" in renderer) renderer.zoomBy(1.25);
        }}>−</button>
        <button type="button" onClick={() => {
          const renderer = rendererRef.current;
          if (renderer && "fitWorld" in renderer) renderer.fitWorld();
        }}>Full map</button>
      </>}
      <button type="button" onClick={() => setMode(mode === "3d" ? "2d" : "3d")}>
        {mode === "3d" ? "Classic 2D" : "Enter 3D"}
      </button>
      <a href="/art-credits" target="_blank" rel="noreferrer">Credits</a>
    </div>
    {mode === "3d" && <div className="world-controls">DRAG · PAN <span>/</span> SCROLL · ZOOM <span>/</span> RIGHT DRAG · ORBIT</div>}
    {loading && <div className="world-loading" role="status">Loading battlefield assets…</div>}
    {error && <div className="world-loading" role="alert">{error}</div>}
  </div>;
}
