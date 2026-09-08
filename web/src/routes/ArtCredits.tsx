import { Link } from "react-router-dom";

export default function ArtCredits() {
  return <div className="card" style={{ maxWidth: 850, margin: "32px auto" }}>
    <p className="hint">CERO ONE CITY / ART & TECHNOLOGY</p>
    <h1>World credits</h1>
    <p>The battlefield combines one rigged human, scanned surface materials, and original mechanical units and
      industrial structures.</p>
    <h2>Humans & animation</h2>
    <p>The armed human and the unarmed survivor use the Soldier by Adobe Mixamo, distributed with the Three.js
      examples. Materials, proportions, equipment and animation blending are adapted for this game. The asset is
      incorporated in the game, not offered as a standalone model library. Every machine - the fifteen-type cast
      of workers, strikers, walkers, drones and the rest - is original procedural geometry made for Cero One City.</p>
    <p><a href="https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html" target="_blank" rel="noreferrer">Mixamo royalty-free project-use terms</a>
      {" · "}<a href="https://github.com/mrdoob/three.js/tree/r185/examples/models/gltf" target="_blank" rel="noreferrer">Model distribution source</a></p>
    <h2>Scanned materials</h2>
    <p><a href="https://polyhaven.com/a/rubble">Rubble</a>, <a href="https://polyhaven.com/a/concrete">Concrete</a>,
      {" "}and <a href="https://polyhaven.com/a/rocky_terrain_02">Rocky Terrain 02</a> by Poly Haven contributors,
      licensed <a href="https://polyhaven.com/license">CC0</a>. Diffuse, normal and roughness maps are bundled locally.</p>
    <h2>Original world art</h2>
    <p>Terrain, ruined structural frames, industrial buildings, resource machinery, drones and battle effects
      are generated for Cero One City. No film character models, names, logos or film footage are included.</p>
    <p>The portraits in the command post and agent screens are renders of these same models
      (<code>web/tools/render-portraits.mjs</code>), so what you inspect is what fights.</p>
    <p>Rendering: <a href="https://threejs.org/license/">Three.js (MIT)</a>. The Classic 2D view remains available.</p>
    <Link to="/matches">Return to live matches →</Link>
  </div>;
}
