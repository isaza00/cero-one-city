// React wrapper owning a MapRenderer lifecycle.

import { useEffect, useRef } from "react";
import type { GameState } from "../api/types";
import { MapRenderer } from "./MapRenderer";

export default function MapView({ state, perspective = null, sizePx = 640 }: {
  state: GameState | null;
  perspective?: number | null;
  sizePx?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const readyRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const renderer = new MapRenderer();
    rendererRef.current = renderer;
    if (hostRef.current) {
      readyRef.current = renderer.init(hostRef.current, sizePx);
    }
    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [sizePx]);

  useEffect(() => {
    if (!state) return;
    readyRef.current?.then(() => rendererRef.current?.render(state, perspective));
  }, [state, perspective]);

  return <div ref={hostRef} className="map-host" style={{ width: sizePx, height: sizePx }} />;
}
