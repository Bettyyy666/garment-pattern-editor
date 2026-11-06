# CLAUDE.md

Guidance for working on **garment-pattern-editor**, a browser-based editor for 2D garment sewing
patterns stored as GarmentCode specification JSON. Read this before adding features.

## Run, lint, format

```bash
npm start              # serves the repo at http://localhost:8000 (npx http-server, cache off)
python3 -m http.server 8000   # alternative, no npm needed
npm install            # once, for dev tools only
npm run lint           # eslint src (must pass with 0 errors)
npm run format         # prettier: src/**/*.js, css, index.html
```

- No build step and no runtime dependencies. Plain ES modules loaded by `<script type="module" src="src/main.js">`.
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
src/model/           document model: edges, panels, stitches, marks, templates
src/operations/      design operations + registry (operations/index.js)
src/io/              GarmentCode JSON parse/build, PNG tracing, file routing
src/spec.js          saved specification: save, dirty state, export dialog, download
src/ui/              render (SVG), inspector, pointer, keyboard, tools, viewport, snapping, toast, dom
examples/            skirt_specification.json + skirt_pattern.png for manual testing
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

- **Panel** `{ id, name, edges, tint, place, label }`
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
   is not already used by tools (v h p l c e), `f` (fit) or another operation.
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
- **Simulation view (planned):** take `buildSpec()` output, run or fetch the simulation, and render it
  in a new `src/ui/simulation.js` started from `main.js`. Keep the 2D editor working without it.
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
