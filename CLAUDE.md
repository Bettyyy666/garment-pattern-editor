# CLAUDE.md

Guidance for working on **garment-pattern-editor**, a browser-based editor for 2D garment sewing
patterns stored as GarmentCode specification JSON. Read this before adding features.

## Run, lint, format

```bash
git submodule update --init   # once: intrinsic-dart at a pinned commit in server/intrinsic-dart
npm start              # server/dart_server.py via uv: serves the repo + dart solver API on :8000 (cache off)
npm run start:static   # editor only (npx http-server), darts cannot be solved
npm install            # once, for dev tools only
npm run lint           # eslint src (must pass with 0 errors)
npm run format         # prettier: src/**/*.js, css, index.html
```

- No build step and no runtime JS dependencies. Plain ES modules loaded by `<script type="module" src="src/main.js">`.
- Dart solving runs intrinsic-dart's Python code unchanged in `server/dart_server.py` (POST `/api/dart/solve`,
  the same calls as the demo's `set_outline` / `update_solution`). Do not port the solver to JS: results must
  match the repo. Python deps are pinned in `server/pyproject.toml` to intrinsic-dart's `uv.lock` versions.
- Bodies for the 3D view come from a body dataset (`meshes/<id>.obj` in metres with GarmentCode body
  topology, `measurements/<number>.yaml`) and GarmentCode's `ggg_body_segmentation.json`. `npm start` defaults to the
  sibling checkout `../body2garmentCode` (`--bodies DIR --segmentation FILE` to change). No body data is committed here.
- Opening `index.html` straight from disk does not work, because ES modules need HTTP.
- Run `npm run lint` and `npm run format` before every commit.

## Architecture in one minute

```
index.html           all markup (toolbox, canvas <svg id="canvas">, inspector, dialogs)
css/styles.css       design tokens on :root (light + dark), layout
src/main.js          entry: wires DOM events, calls init*() functions, boots the app
src/state.js         `app` store, undo/redo (pushHistory/undo/redo/snapshot/restore), nid()
src/config.js        constants (TINTS, STITCH_COLORS, VEPS, STORAGE_KEY)
src/geometry.js      pure vector/polygon math + polygon-level cut detection (splitOnce/splitPolygon)
src/model/           document model: edges, panels, stitches, marks, templates; intrinsic shape (intrinsic.js);
                     dart settings + solver outline sampling (dart-solve.js); darts read from same-panel
                     stitches and closed into the reference outline (dart-detect.js); cone surface on a panel
                     (cone3d.js); panel name -> body part + rigid placement next to it (body-place.js)
src/operations/      design operations + registry (operations/index.js)
src/io/              GarmentCode JSON parse/build, PNG tracing, file routing, dart solver client (dart-server.js),
                     per-panel ConeDartModel analysis written to panels[k].intrinsic (intrinsic-analysis.js),
                     cached per-dart solves for the 2D dart openings (dart-results.js), body list/load (body.js),
                     server triangulation of flat panels for depth sorting (panel-mesh.js)
server/              dart_server.py (static files + solver/mesh/body API), body.py (body mesh decimation, trunk
                     slices, limb axes, levels), pyproject.toml, intrinsic-dart (git submodule)
src/spec.js          saved specification: save, dirty state, export dialog, download
src/ui/              render (SVG), inspector, sections (drop-down sidebar sections), pointer, keyboard, tools,
                     viewport, snapping, toast, dom,
                     dart-view (the three-pane cone-dart dialog), dart-editor (Darts block of Selection: every
                     optimize()/develop() parameter of the selected dart), view3d (3D pane right of the 2D canvas, a
                     <canvas>: panels placed by name around the target body, see below; no simulation)
examples/            default_specification.json (loaded at startup and by Reset to default),
                     skirt_specification.json + skirt_pattern.png for manual testing
```

### The `app` store (src/state.js)

All mutable state lives on one exported object, `app`. ES module bindings are read-only for importers,
so never add a module-level `let` that other modules need to write. Add a field to `app` instead.

- `app.state = { panels, marks, stitches }` is the **document**. It is the only undoable part, and it
  is serialized by `snapshot()`, so keep it JSON-serializable: no class instances, Maps or functions.
- `app.spec` is the last saved specification `{ name, version, savedAt, text, snap, extra }`.
  - `isDirty()` compares `spec.snap` with `snapshot()`.
  - `extra` keeps the source file's `parameters` and `properties` so they are written back on save.
- UI state lives in `app.sel`, `app.tool`, `app.draft`, `app.drag`, `app.view` (pan/zoom), `app.opts` (view toggles) and similar fields.
- `app.view3d` (`on`, camera `yaw/el/c/half`) is the 3D pane beside the 2D canvas (`on` = shown, the *3D view*
  button toggles it). While it is shown, `render()` and `fit()` also update `ui/view3d.js`, so the usual mutation
  pattern updates both panes. 2D moves only change `place.ox/oy`, which `world3D()` ignores.
- `app.body` is the body the 3D view places panels on (`io/body.js`, from `GET /api/body/<id>`; the body select in the
  3D pane, remembered in localStorage). It is not part of the document. With no body, panels sit rigidly at
  `place.t/rot` as GarmentCode places them.

### 3D view (ui/view3d.js, model/body-place.js)

- `classify(name)` maps a panel name to `{ part: torso|arm|leg, kind, side, face }` by tokens (`sleeve`, `cuff`, `sl`
  → arm; `pant(s)`, `leg` → leg; `wb`/`band`/`belt`, `skirt`, `collar` kinds; `left`/`right`; `f`/`front`/`ftorso`
  vs `b`/`back`/`btorso`). Missing side/face fall back to the rigid centroid (+x = left, z < 0 = back).
- `arrange(items, body)` moves each panel **rigidly and flat** next to its body part, 6 cm off the body (panels do
  not hug the body):
  - torso pieces stay upright facing ±z with x kept, in front of the body's front-most / behind its back-most point
    over their height range; one vertical shift puts bodice tops at the neck level (else bands/skirts at the waist);
  - sleeves/cuffs/pants are turned in their plane so their local x or y (whichever is closer) runs along the limb
    axis, in front of / behind the limb; sleeves start at the shoulder end, pants at the waist.
- Only darted panels are curved: they draw their solved `cone_surface()` on the moved panel, apex always away from
  the body.
- *Height* slider: a narrow translucent vertical bar at the top right of the 3D pane (`app.view3d.lift`, −40…+40 cm; the reset button at its bottom or a double-click sets 0): moves every panel up or down
  in 3D only, added to each panel's world position in `scene()` (so cones, seams, cut lines and picking follow). It is
  view state: no undo step, the pattern and its exported placement are unchanged.
- 2D and 3D edit the same document. Every drawn face keeps its corners' 2D canvas points, so a 3D click maps back to
  the pattern (orthographic camera: screen and panel plane are affine, barycentric coordinates carry over). The
  Insert dart tool works in 3D too and shares `app.draft` / `app.hover` with 2D (start in one view, finish in the
  other; both preview it), then calls the same `insertDart()`. Clicking a dart apex in 3D selects that dart;
  dragging it moves the dart as in 2D (same `app.drag` mode `'dart'`, `moveDartTo()` keeps it inside the panel, one
  undo step, live re-solve; the 2D point under the cursor is re-picked on every move). With the Erase tool, clicking a
  dart apex in either view deletes the dart (`deleteDart()` in `operations/dart.js`, also the Darts block's button). Every
  dart's cut line (apex to the edge, cast across the reference outline like the solver) is drawn in 3D on the panel
  as shown: on the cone surface for a cone panel (solid for its opened dart, at its solved pose; dashed otherwise). Flat panels are triangulated on the server (`POST /api/panel/mesh`) only so they depth-sort against the
  body. Body and fabric triangles share one painter's sort; clicks are picked in JS against the drawn faces.
- Target body: the select in the 3D pane (dataset bodies) or *Load body…*: one `.obj` in GarmentCode body topology
  (23752 vertices, metres or cm, y up) and optionally its GarmentCode measurements `.yaml`, posted to
  `POST /api/body/upload`. The yaml gives exact neck/waist heights (`height − head_l`, `− waist_line`); without it they
  are estimated from the narrowest torso slices (within ~1–3 cm on the dataset bodies).

### Mutation pattern (always follow it)

```js
pushHistory();          // 1. snapshot BEFORE changing app.state
/* mutate app.state */  // 2. change the document
renderAll();            // 3. re-render the canvas and the inspector
```

- `render()` redraws only the SVG canvas. It is cheap and runs on every pointer move.
- `renderInspector()` redraws the right-hand panel. Call it after any change that matters to the user.
- Never edit the DOM of the canvas directly. `render()` rebuilds `#world` from state each time.

### Module rules

- **No top-level side effects** outside `src/main.js`. Event listeners, async capability lookups and
  similar setup go in an exported `initX()` function that `main.js` calls (see `initPointer`,
  `initKeyboard`, `initDownloads`). Modules import each other in cycles, so top-level code can run
  before its imports are ready.
- Keep pure geometry in `geometry.js` or `model/`, with no DOM access, so it can be unit tested in Node later.
- Use named exports only, one concern per file, with a one-line header comment saying what the file is for.

## Data model and coordinate conventions

All editor geometry is in **centimetres, canvas coordinates (x right, y down)**.

- **Panel** `{ id, name, shape, darts, edges, tint, place, label }`
  - `shape = { start, dir, len, turn, curve }` is the intrinsic representation (edge lengths, turning angles);
    it is re-derived from `edges` in `snapshot()`/`renderAll()`, and inspector edits rebuild `edges` from it.
  - `darts[i] = { id, at, defect, cut, angleW, scaleW, lengthW, smooth, cutMode, cutW, angleLocks, scaleLocks }`
    (canvas cm, radians; locks are perimeter fractions from vertex 0). `solveDart()` in `io/dart-server.js`
    sends the sampled outline (solver frame: y up, CCW) to the server and reshapes its JSON for `ui/dart-view.js`.
  - A dart with `legs: [eidIn, eidOut]` is a GarmentCode dart: two adjacent edges stitched together, apex at their
    shared vertex, Ω = wedge angle, cut = bisector. On import these are detected from the stitches when the file
    has no `darts`; the solver outline closes the legs into one mouth segment (`closedEdges`).
  - Insert dart tool (A): click the apex inside a panel, then toward the edge (sets `cut`). *Add dart* (D) does the
    same from a selected line (apex = line start, cut toward its end) or point (cut toward the nearest edge). New
    darts get the demo's default settings; the solver view opens only from its button. In 2D a darted panel is
    drawn as its **post-cut** outline (the solved develop() outline of its main dart — the selected one, else the
    first — placed at the apex, turned by the cut angle): solid stroke, tint fill. The pre-cut outline is a faint
    dashed reference on top (`app.opts.precut`, View > *Pre-cut outline*) and a transparent click area underneath.
    Other darts on the panel show only their opening wedge (the solver opens one dart at a time). Stitched edges
    of a darted panel are drawn on the post-cut outline (`model/post-cut.js` maps each edge's outline segments onto
    develop()'s boundary; the edge the cut hits splits at the opening; sewn dart legs are closed and not drawn); `app.dartSel` is the
    dart edited in the Darts block; dragging an apex moves the whole dart (cut angle kept, apex kept inside the
    panel, one undo step) and re-solves live. Every solve is drawn at the apex and cut angle it was solved for
    (`solvedPose()` in `io/dart-results.js`, relative to the panel's first vertex), never at the live apex: while a
    newer solve is pending, an older result placed at the dragged apex would shake the whole post-cut outline. The 3D view draws a panel with a solved dart as that solve's
    `cone_surface()` (selected dart, else the panel's first), placed by `model/cone3d.js`: x/y as the 2D outline,
    z along the panel normal, shifted so the boundary sits on the panel plane on average (next to a body: apex away from
    the body).
  - After every load, `analyzeLoaded()` (spec.js) posts each panel to `/api/dart/analyze` (ConeDartModel's
    `original_lengths` / `original_turns`, `ray_cut` per dart). Results live outside `app.state` (so loading is not
    dirty) and `buildSpec()` writes them as `panels[k].intrinsic` while they still match the panel.
  - `edges` is a closed loop: `edges[i].b` must equal `edges[i+1].a`.
  - `place = { t:[x,y,z], rot:[rx,ry,rz], ox, oy }` holds the GarmentCode frame plus a 2D layout offset.
  - Conversion between frames:
    - `fromLocal(place, v)`: GarmentCode local (y up) to canvas.
    - `toLocal(place, w)`: canvas to GarmentCode local.
  - **Moving a panel on the canvas must not change its 3D placement.** Always use
    `translatePanel(p, d)`, which shifts the geometry *and* `place.ox/oy`.
  - Mirror, rotate and other shape changes edit `edges` only and keep `place`.
- **Edge** `{ eid, k, a, b, ... }`, where `k` is one of:
  - `line`
  - `quad` (`c1`)
  - `cubic` (`c1`, `c2`)
  - `arc` (`ctr`, `r`, `ccw`): `ccw` is true when the angle increases in canvas coordinates (y down),
    which is the same as the SVG sweep-flag.

  Use the helpers in `model/edges.js` (`edgeAt`, `edgeSample`, `edgeSplit`, `edgeRev`, `edgeMap`,
  `paramAtFrac`, `fracAtParam`, `paramAtPoint`) instead of touching control points by hand.
- **Stitch** `{ sid, e:[eidA, eidB], cut? }` references edges **by `eid`**, never by index.
  - Indices are only computed at export time in `buildSpec()`.
  - `cut: true` marks seams created by a split.
- **Mark** `{ id, type: point|line|curve, pts, panelId }` is a user-drawn input for operations.
  - Curves are Catmull-Rom through `pts`; `markPts(m)` returns the sampled polyline.
- New ids always come from `nid('p'|'e'|'m'|'s')`.

### GarmentCode conventions (verified against pygarment)

- Units: `properties.units_in_meter` (100 means cm). The editor always exports cm.
- Curvature uses relative coordinates: control = `start + x*(end-start) + y*perpL(end-start)`,
  where `perpL(e) = [-e.y, e.x]` in local y-up space.
- Circle `params = [radius, large_arc, right]`. In local y-up space `right` is the SVG sweep flag.
  After the y flip to canvas, `ccw = !right`.
- Stitched edges run in **opposite directions**: the start of edge A meets the end of edge B.
  That is why `insertVertex` splits the partner edge at arc-length fraction `1 - f`.
- Back panels have `translation[2] < 0`. On import they are laid out to the right of the front panels
  with `translatePanel`, which is layout only.

## Adding a design operation

1. Create `src/operations/<name>.js` and export a function `run()` that:
   - reads its input from `app.sel` and the marks (see `resolveCut()` in `split.js`);
   - if the input is missing or invalid, calls `toast('…', true)` and returns **without** calling `pushHistory()`;
   - otherwise calls `pushHistory()`, edits `app.state` and then `renderAll()`;
   - ends with `toast()` describing what changed.
2. **If it changes edges:** keep stitches valid.
   - Add vertices with `insertVertex(panel, point)`. It splits stitched partner edges and rewires the stitches.
   - Build new panels from existing edge objects so `eid`s, and the stitches that point to them, survive.
   - When a panel is removed, drop the stitches that reference its edges (see `delSel()`).
   - When a new seam is created, push a stitch `{ sid: nid('s'), e: [eidA, eidB] }` with opposite edge directions.
3. Add a button to the *Design operations* section in `index.html` (`<button class="btn" id="op-<name>">`).
4. Register it in `src/operations/index.js`: `{ id, button: '#op-<name>', key: '<optional key>', run }`.
   `main.js` wires the click and `ui/keyboard.js` wires the shortcut automatically. Check that the key
   is not already used by tools (v h p l c e a), `f` (fit) or another operation.
5. If the button should be disabled when it does not apply, add that check in `renderInspector()`
   (see how `op-split` and `op-mirror` are enabled).

## Adding other features

- **New toolbox tool:**
  - add a `.tool` button with `data-tool` in `index.html`;
  - add a hint in `HINTS` (`ui/tools.js`) and a key in `KEYS` (`ui/keyboard.js`);
  - handle it in `ui/pointer.js`.
- **New importer:**
  - parse into the model in `src/io/<format>.js`;
  - route it in `io/open-file.js`;
  - use `lineEdges()` and `defaultPlace()` for formats without a GarmentCode frame.
- **New export field:** extend `buildSpec()` in `io/garmentcode.js`. Anything read on import that must
  survive a round trip goes into `app.spec.extra` or onto the panel object.
- **View toggle:** add a checkbox in the *View* section, add a key to `app.opts`, add it to the
  checkbox list in `main.js`, then read `app.opts.<key>` in `render()`.
- **Simulation view (planned):** the 3D view already gives an initial arrangement (panels placed by name around
  the body, darted panels as cones). A simulation would take `buildSpec()` output plus that placement, run or fetch the simulation, and render it in a new
  `src/ui/simulation.js` started from `main.js`. Keep the 2D editor working without it.
- **Styling:** use the CSS custom properties on `:root`. Every color is defined for light and dark
  (`prefers-color-scheme` and `[data-theme]`). Do not hard-code colors in components.

## Verifying a change

There is no automated test suite yet. Before committing:

1. `npm run lint` passes and `npm start` loads with no console errors.
2. Open `examples/skirt_specification.json`. You should see 4 panels and 6 stitches.
3. Draw a line across `skirt_front` and press *Split along cut*. The toast should read
   `Stitches: 6 → 9`: both side seams are split and the new seam is stitched.
4. Save, then *Export JSON*. Check that:
   - every stitch references existing panel and edge indices;
   - pieces keep their parent's `translation`.
5. Import the exported JSON through *Import pasted*, save again and compare. Vertices and curvature
   should be identical.
6. Open `examples/skirt_pattern.png`. Tracing at 3 px/cm should find 4 panels.
7. Check undo and redo for the new action.

When an automated suite is added, put pure-logic tests (geometry, edges, GarmentCode round trip) under
`tests/` and run them with Node. Those modules do not touch the DOM.

## Git

- Commit messages: a short imperative summary line, then a body explaining *why*.
- Keep commits focused: one feature or fix per commit, with lint and format applied.
