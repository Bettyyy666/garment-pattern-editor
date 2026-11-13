"""Body meshes for the editor's 3D view.

A body is an OBJ in GarmentCode body topology (the vertex order of GarmentCode's bodies, so its vertex segmentation
ggg_body_segmentation.json applies: body, left_arm, right_arm, left_leg, right_leg; y up, feet at y = 0, metres or
cm), plus optionally its GarmentCode measurements yaml (cm). Bodies come from a dataset laid out as
<root>/meshes/<id>.obj + <root>/measurements/<number>.yaml, or are uploaded from the browser. Returns, in cm:
  mesh      the body decimated by vertex clustering (for display only)
  trunk     horizontal slices of body + legs (arms excluded): [y, xmin, xmax, zmin, zmax] every 1 cm
  limbs     per arm / leg: axis origin (the end next to the torso), unit axis pointing away from it, length and
            radius profile [[s, r], ...] every 2 cm (max distance of the limb's vertices from the axis)
  levels    neck (height - head_l) and waist (neck - waist_line) heights; without a yaml they are estimated from
            the mesh (narrowest torso slice, offsets fitted to GarmentCode measurements of the dataset bodies)
"""

import json
import re
from pathlib import Path

import numpy as np

GRID = 1.5  # cm, vertex clustering cell of the display mesh


def read_obj(lines):
    verts, faces = [], []
    for line in lines:
        if line.startswith("v "):
            verts.append(line.split()[1:4])
        elif line.startswith("f "):
            ids = [int(t.split("/")[0]) - 1 for t in line.split()[1:]]
            faces.extend([ids[0], ids[i], ids[i + 1]] for i in range(1, len(ids) - 1))
    return np.array(verts, dtype=float), np.array(faces, dtype=np.int64)


def read_measurements(text):
    """GarmentCode body yaml: a `body:` block of `name: number` lines."""
    out = {}
    for line in text.splitlines():
        m = re.match(r"\s+(\w+):\s*([-+0-9.eE]+)\s*$", line)
        if m:
            out[m.group(1)] = float(m.group(2))
    return out


def decimate(verts, faces, grid):
    cell = np.floor(verts / grid).astype(np.int64)
    _, inv = np.unique(cell, axis=0, return_inverse=True)
    inv = inv.ravel()
    count = np.bincount(inv)
    points = np.stack([np.bincount(inv, weights=verts[:, k]) for k in range(3)], axis=1) / count[:, None]
    f = inv[faces]
    keep = (f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])
    f = f[keep]
    _, first = np.unique(np.sort(f, axis=1), axis=0, return_index=True)
    return points, f[np.sort(first)]


def limb(points, toward):
    """Straight axis through a limb (principal direction), oriented along `toward`, with its radius profile."""
    centre = points.mean(axis=0)
    axis = np.linalg.svd(points - centre, full_matrices=False)[2][0]
    if axis @ toward < 0:
        axis = -axis
    s = (points - centre) @ axis
    origin = centre + s.min() * axis
    s -= s.min()
    radial = np.linalg.norm((points - origin) - np.outer(s, axis), axis=1)
    profile = []
    for a in np.arange(0, s.max() + 2, 2.0):
        band = radial[(s >= a - 1) & (s < a + 1)]
        if len(band):
            profile.append([float(a), float(band.max())])
    return dict(origin=origin.round(3).tolist(), axis=axis.round(6).tolist(), length=float(s.max()),
                radius=profile)


class BodyError(ValueError):
    pass


def narrowest(points, lo, hi):
    """Height in [lo, hi] where the horizontal slice of points has the smallest bounding area."""
    best, at = np.inf, lo
    for y in np.arange(lo, hi, 0.5):
        band = points[np.abs(points[:, 1] - y) < 0.75]
        if len(band):
            area = np.ptp(band[:, 0]) * np.ptp(band[:, 2])
            if area < best:
                best, at = area, y
    return float(at)


def body_info(obj_lines, yaml_text, segmentation):
    verts, faces = read_obj(obj_lines)
    n = 1 + max(max(v) for v in segmentation.values())
    if len(verts) != n:
        raise BodyError(f"the OBJ has {len(verts)} vertices; a body must use GarmentCode's body topology ({n} "
                        "vertices, as the bodies in GarmentCode/assets/bodies) so its parts can be found")
    verts = verts - [0, verts[:, 1].min(), 0]  # feet on the floor
    if verts[:, 1].max() < 3:
        verts = verts * 100  # metres -> cm
    seg = {k: np.array(v, dtype=np.int64) for k, v in segmentation.items()}

    shown, tris = decimate(verts, faces, GRID)  # display mesh

    # Trunk slices (body + legs), arms left out so torso garments wrap the torso only.
    trunk_ids = np.concatenate([seg[k] for k in ("body", "left_leg", "right_leg") if k in seg])
    trunk = verts[trunk_ids]
    slices = []
    for y in np.arange(np.floor(trunk[:, 1].min()), trunk[:, 1].max() + 1, 1.0):
        band = trunk[np.abs(trunk[:, 1] - y) <= 1.0]
        if len(band):
            slices.append([float(y), *map(float, (band[:, 0].min(), band[:, 0].max(),
                                                  band[:, 2].min(), band[:, 2].max()))])

    limbs = {}
    for name, toward in (("left_arm", [1, 0, 0]), ("right_arm", [-1, 0, 0]),
                         ("left_leg", [0, -1, 0]), ("right_leg", [0, -1, 0])):
        if name in seg:
            limbs[name] = limb(verts[seg[name]], np.array(toward, dtype=float))

    m = read_measurements(yaml_text) if yaml_text else {}
    if {"height", "head_l", "waist_line"} <= m.keys():
        neck = m["height"] - m["head_l"]
        levels = dict(neck=neck, waist=neck - m["waist_line"], source="measurements")
    else:
        h, torso = float(verts[:, 1].max()), verts[seg["body"]]
        levels = dict(neck=narrowest(torso, 0.80 * h, 0.92 * h) - 0.016 * h,
                      waist=narrowest(torso, 0.56 * h, 0.70 * h) - 0.008 * h, source="estimated from the mesh")
    return dict(mesh=dict(verts=shown.round(2).tolist(), faces=tris.tolist()), trunk=slices, limbs=limbs,
                measurements=m, levels=levels)


class BodyLibrary:
    def __init__(self, root, segmentation):
        self.root = Path(root) if root else None
        self.segmentation_path = Path(segmentation) if segmentation else None
        self._seg = None
        self._cache = {}  # id -> JSON bytes (dataset bodies and uploads)

    def segmentation(self):
        if self._seg is None:
            if not (self.segmentation_path and self.segmentation_path.is_file()):
                raise BodyError("GarmentCode's ggg_body_segmentation.json was not found: start the server with "
                                "--segmentation FILE")
            self._seg = json.loads(self.segmentation_path.read_text())
        return self._seg

    def available(self):
        return bool(self.root and (self.root / "meshes").is_dir() and self.segmentation_path
                    and self.segmentation_path.is_file())

    def upload(self, name, obj_text, yaml_text=None):
        """A body sent from the browser: OBJ text, optional measurements yaml text. Returns its id."""
        body_id = "upload:" + (re.sub(r"[^\w.-]+", "_", name or "body") or "body")
        info = body_info(obj_text.splitlines(), yaml_text, self.segmentation())
        info["id"] = body_id
        self._cache[body_id] = json.dumps(info).encode()
        return body_id

    def measurements_for(self, body_id):
        number = body_id.split("_")[0]
        path = self.root / "measurements" / f"{number}.yaml"
        return path if path.is_file() else None

    def list(self):
        uploads = [dict(id=i) for i in self._cache if i.startswith("upload:")]
        if not self.available():
            return dict(bodies=uploads, error="No body dataset: start the server with --bodies DIR --segmentation FILE")
        ids = sorted(p.stem for p in (self.root / "meshes").glob("*.obj"))
        return dict(bodies=[dict(id=i, measurements=bool(self.measurements_for(i))) for i in ids] + uploads)

    def get(self, body_id):
        if body_id in self._cache:
            return self._cache[body_id]
        if not self.available() or not re.fullmatch(r"[\w.-]+", body_id):
            return None
        mesh = self.root / "meshes" / f"{body_id}.obj"
        if not mesh.is_file():
            return None
        yaml = self.measurements_for(body_id)
        with open(mesh) as f:
            info = body_info(f, yaml.read_text() if yaml else None, self.segmentation())
        info["id"] = body_id
        self._cache[body_id] = json.dumps(info).encode()
        return self._cache[body_id]
