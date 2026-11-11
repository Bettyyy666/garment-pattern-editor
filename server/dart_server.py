"""Local server for the garment pattern editor.

Serves the static editor and runs intrinsic-dart's single-cone dart solver for it, using the repo's own code
(git submodule server/intrinsic-dart) with exactly the calls of the demo app (scripts/apps/cone_dart/app.py):
  set_outline:      triangulate_polygon(vertices, split_boundary=False) -> ConeDartModel(points, triangles, boundary)
  update_solution:  model.optimize(point, defect, regularization) -> develop(...) -> cone_surface(...)
  analyze:          ConeDartModel(...) on a panel's reference outline (its darts closed) -> original_lengths,
                    original_turns; ray_cut(vertices, apex, cut_angle) for each dart read from the pattern
The browser only renders the JSON this returns.

Run:  uv run --project server python server/dart_server.py [--port 8000]
"""

import argparse
import json
import sys
import threading
from collections import OrderedDict
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "intrinsic-dart" / "src"))

from intrinsic_dart.cone_dart.development import develop  # noqa: E402
from intrinsic_dart.cone_dart.geometry import ConeDartError, ray_cut  # noqa: E402
from intrinsic_dart.cone_dart.model import ConeDartModel  # noqa: E402
from intrinsic_dart.cone_dart.surface import cone_surface  # noqa: E402
from intrinsic_dart.triangulation import triangulate_polygon  # noqa: E402

SOLVER_ERRORS = (ConeDartError, np.linalg.LinAlgError, ValueError, RuntimeError)
_models = OrderedDict()  # outline bytes -> ConeDartModel (the demo builds one per loaded outline)
_lock = threading.Lock()  # models carry mutable weights/locks and a response cache


def get_model(vertices):
    key = vertices.tobytes()
    if key in _models:
        _models.move_to_end(key)
        return _models[key]
    points, triangles, boundary, _ = triangulate_polygon(vertices, split_boundary=False)
    model = ConeDartModel(points, triangles, boundary)
    if len(model.vertices) != len(vertices) or not np.allclose(model.vertices, vertices):
        raise ConeDartError("meshing unexpectedly split or reordered outline edges")
    _models[key] = model
    if len(_models) > 8:
        _models.popitem(last=False)
    return model


def floats(d):
    return {k: float(v) for k, v in d.items()}


def xy(z):
    z = np.asarray(z)
    return np.column_stack((z.real, z.imag)).tolist()


def model_info(model):
    return dict(vertices=model.vertices.tolist(),
                original_turns=model.original_turns.tolist(),
                original_lengths=model.original_lengths.tolist(),
                operator_diagnostics=floats(model.operator_diagnostics),
                mesh_stats=dict(mesh_vertices=len(model.steklov.mesh_vertices),
                                triangles=len(model.steklov.triangles),
                                boundary_vertices=len(model.vertices),
                                interior_vertices=len(model.steklov.interior)))


def analyze(req):
    """Intrinsic description of one panel: the model's boundary data plus each dart's apex, defect and cut."""
    model = get_model(np.array(req["outline"], dtype=float))
    out = model_info(model)
    out["darts"] = []
    for dart in req.get("darts", []):
        point, angle, defect = np.array(dart["cone"], dtype=float), float(dart["cut_angle"]), float(dart["defect"])
        try:
            if not 0 < defect < 2*np.pi:
                raise ConeDartError("defect must lie in (0, 2π)")
            cut = ray_cut(model.vertices, point, angle)
        except SOLVER_ERRORS as error:
            out["darts"].append(dict(error=str(error)))
            continue
        out["darts"].append(dict(cut=dict(point=[float(cut.point.real), float(cut.point.imag)], edge=int(cut.edge),
                                          fraction=float(cut.fraction), length=float(cut.length),
                                          angle=float(cut.angle))))
    return out


def solve(req):
    model = get_model(np.array(req["outline"], dtype=float))
    out = model_info(model)
    if req.get("include_mesh"):
        out["mesh"] = dict(points=model.steklov.mesh_vertices.tolist(), triangles=model.steklov.triangles.tolist())
    point = np.array(req["cone"], dtype=float)
    angle = float(req["cut_angle"])
    # Same updates as the demo's controls: uniform energy coefficients and the two lock sets.
    model.angle_weights[:] = float(req["angle_weight"])
    model.scale_weights[:] = float(req["scale_weight"])
    model.length_weights[:] = float(req["length_weight"])
    model.angle_locked_vertices.clear()
    model.angle_locked_vertices.update(int(i) for i in req.get("angle_locks", []))
    model.scale_locked_vertices.clear()
    model.scale_locked_vertices.update(int(i) for i in req.get("scale_locks", []))
    try:
        metric = model.optimize(point, float(req["defect"]), float(req["regularization"]))
        cut_options = {}
        mode = req.get("cut_length_mode", "preserve")
        if mode == "optimize":
            cut_options["cut_length_weight"] = float(req["cut_length_weight"])
        elif mode == "ideal":
            reference_length = ray_cut(model.vertices, point, angle).length
            cut_options["target_cut_length"] = reference_length/(1-metric.defect/(2*np.pi))
        development = develop(model, metric, point, angle, **cut_options)
    except SOLVER_ERRORS as error:
        out["error"] = str(error)
        return out
    out["metric"] = dict(eta=metric.eta.tolist(), curvature_change=metric.curvature_change.tolist(),
                         turns=metric.turns.tolist(), target_lengths=metric.target_lengths.tolist(),
                         defect=float(metric.defect), diagnostics=floats(metric.diagnostics))
    cut = development.cut
    out["development"] = dict(
        boundary=xy(development.boundary), cut_length=float(development.cut_length),
        cut=dict(point=[float(cut.point.real), float(cut.point.imag)], edge=int(cut.edge),
                 fraction=float(cut.fraction), length=float(cut.length), angle=float(cut.angle)),
        edge_indices=development.edge_indices.tolist(),
        segment_target_lengths=development.segment_target_lengths.tolist(),
        segment_corrected_lengths=development.segment_corrected_lengths.tolist(),
        factors=development.factors.tolist(), diagnostics=floats(development.diagnostics))
    try:
        surface = cone_surface(development, metric.defect)
        pocket_faces = sorted(int(i) for p in surface.pockets for i in p.faces)
        out["surface"] = dict(vertices=surface.vertices.tolist(), faces=surface.faces.tolist(),
                              pocket_faces=pocket_faces, fan_faces=surface.fan_faces.tolist(),
                              pockets=len(surface.pockets), pitch=float(surface.pitch))
    except SOLVER_ERRORS as error:
        out["surface_error"] = str(error)
    return out


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/dart/health":
            return self.send_json(200, dict(ok=True, numpy=np.__version__))
        return super().do_GET()

    def do_POST(self):
        handler = {"/api/dart/solve": solve, "/api/dart/analyze": analyze}.get(self.path)
        if handler is None:
            return self.send_json(404, dict(error="not found"))
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            with _lock:
                result = handler(req)
        except SOLVER_ERRORS as error:
            return self.send_json(200, dict(error=str(error)))
        except (KeyError, TypeError, json.JSONDecodeError) as error:
            return self.send_json(400, dict(error=f"bad request: {error}"))
        self.send_json(200, result)

    def log_message(self, fmt, *args):
        # Log solver requests and server errors only; static file requests (and their 404s) stay quiet.
        text = fmt % args
        if "/api/" in text or (fmt.startswith("code") and str(int(args[0])).startswith("5")):
            super().log_message(fmt, *args)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    root = HERE.parent
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=str(root)))
    print(f"Garment pattern editor + dart solver on http://localhost:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
