# Mesh2STEP — tests/make_samples.py
# Versione: 1.6.0 — 2026-10-07 22:00
# Genera mesh di prova (STL) con geometria nota tramite manifold3d (booleane robuste).
import sys, os
import numpy as np
import trimesh
from manifold3d import Manifold

out = sys.argv[1] if len(sys.argv) > 1 else 'tests/samples'
os.makedirs(out, exist_ok=True)

def save(m, name):
    mesh = m.to_mesh()
    tm = trimesh.Trimesh(mesh.vert_properties[:, :3], mesh.tri_verts)
    tm.export(os.path.join(out, name))
    print(name, len(tm.faces), 'tri, volume', round(tm.volume, 4))

# 1) Piastra 40x30x10 con foro passante Ø10 (64 segmenti) -> 6+1 piani, 1 cilindro
plate = Manifold.cube([40, 30, 10]) - Manifold.cylinder(30, 5, 5, 64).translate([20, 15, -10])
save(plate, 'plate_hole.stl')

# 2) Albero: cilindro Ø20 h30 su base 50x50x5 -> cilindro esterno
shaft = Manifold.cube([50, 50, 5]) + Manifold.cylinder(30, 10, 10, 72).translate([25, 25, 5])
save(shaft, 'shaft.stl')

# 3) Sfera r=12 (cupola) su cubo
dome = Manifold.cube([30, 30, 10.5]).translate([-15, -15, -10]) + (Manifold.sphere(12, 64) - Manifold.cube([40, 40, 20]).translate([-20, -20, -20]))
save(dome, 'dome.stl')

# 4) Blocco con due fori e una tasca
blk = Manifold.cube([60, 40, 15])
for x in (12, 48):
    blk = blk - Manifold.cylinder(40, 3, 3, 48).translate([x, 20, -10])
blk = blk - Manifold.cube([20, 20, 10]).translate([20, 10, 8])
save(blk, 'block.stl')

# 5) Piastra con 4 raccordi verticali R5 (hull di 4 cilindri) + foro Ø8 -> cilindri parziali tangenti ai piani
cyls = [Manifold.cylinder(8, 5, 5, 64).translate([x, y, 0]) for x in (5, 45) for y in (5, 25)]
rr = Manifold.batch_hull(cyls) - Manifold.cylinder(20, 4, 4, 48).translate([25, 15, -5])
save(rr, 'rounded_plate.stl')

# 6) Toro (non supportato in v1 -> freeform sfaccettato) in OBJ; piastra in 3MF; mesh aperta
# [v1.4.0 2026-10-07] sfera completa (nessun bordo): deve diventare 2 emisferi analitici nello STEP
save(Manifold.sphere(10, 64), 'sphere_full.stl')
tor = trimesh.creation.torus(major_radius=20, minor_radius=5, major_sections=48, minor_sections=24)
tor.export(os.path.join(out, 'torus.obj')); print('torus.obj', len(tor.faces))
pm = plate.to_mesh(); trimesh.Trimesh(pm.vert_properties[:, :3], pm.tri_verts).export(os.path.join(out, 'plate_hole_3mf.3mf')); print('plate_hole_3mf.3mf')
bm = blk.to_mesh(); bt = trimesh.Trimesh(bm.vert_properties[:, :3], bm.tri_verts)
top = bt.face_normals[:, 2] > 0.99
bt.update_faces(~top); bt.export(os.path.join(out, 'open_block.stl')); print('open_block.stl (aperta)')

# ---------------- [v1.1.0 2026-10-06] nuovi campioni ----------------
from manifold3d import CrossSection
import zipfile, math

# 7) Svasatura: foro Ø6 + cono 90° (Ø12 in superficie) -> cono
cs = Manifold.cube([40, 40, 10]) - Manifold.cylinder(30, 3, 3, 64).translate([20, 20, -10]) - Manifold.cylinder(3.01, 3, 6.01, 64).translate([20, 20, 7])
save(cs, 'countersink.stl')

# 8) Albero tornito (revolve): spallamento con raccordo R3 (toro) e smusso 45° (cono)
# profilo pulito: base Ø24 h10, raccordo concavo R3 tra spalla (z=10) e albero Ø12, albero fino a z=30 con smusso 1x45°
prof = [(0, 0), (12, 0), (12, 10)]
prof += [(9 - 3 * math.sin(t), 13 - 3 * math.cos(t)) for t in [i * (math.pi / 2) / 16 for i in range(17)]]
prof += [(6, 29), (5, 30), (0, 30)]
shaft2 = Manifold.revolve(CrossSection([prof]), 96)
save(shaft2, 'turned_shaft.stl')

# 9) Vite M6x1 (profilo triangolare elicoidale) su testa cilindrica
P, rmax = 1.0, 3.0; depth = 0.6134 * P; npts = 48
pts2 = []
for i in range(npts):
    th = 2 * math.pi * i / npts
    f = (th / (2 * math.pi)) % 1.0
    tri = 1 - abs(2 * f - 1)
    rho = rmax - depth + depth * tri
    pts2.append((rho * math.cos(th), rho * math.sin(th)))
L = 12
thr = Manifold.extrude(CrossSection([pts2]), L, int(L / P * npts), 360 * L / P)  # twist positivo = filetto destro
bolt = thr.translate([0, 0, 6]) + Manifold.cylinder(6.2, 5, 5, 64)
save(bolt, 'bolt_m6.stl')

# 10) Piastra con bombatura liscia (campo di altezze) -> B-spline
bump = Manifold.cube([40, 40, 5]).refine(24)
def wf(v):
    x, y, z = v
    if z > 4.999: z = z + 2.0 * (math.sin(math.pi * x / 40) ** 2) * (math.sin(math.pi * y / 40) ** 2)
    return (x, y, z)
bump = bump.warp(wf)
save(bump, 'bump.stl')

# 10-bis) [v1.5.0] Vaso: solido di rivoluzione con profilo ondulato (raggio 12 +/- 3,5) schiacciato in X (x1,3) -> sezioni ellittiche.
# Superficie liscia che si richiude su se stessa: nessuna primitiva la descrive -> B-spline chiusa (periodica in angolo) + 2 piani (tappi)
from manifold3d import CrossSection
prof = [(0.0, 0.0)] + [(12 + 3.5 * math.sin(2 * math.pi * 1.5 * z / 40), z) for z in np.linspace(0, 40, 61)] + [(0.0, 40.0)]
vase = Manifold.revolve(CrossSection([prof]), 96).warp(lambda v: (v[0] * 1.3, v[1], v[2]))
save(vase, 'vase.stl')

# 10-ter) [v1.6.0] Vaso curvo: lo stesso profilo ondulato ma con asse incurvato (x += 0.05 (z-20)^2, fino a 20 mm agli estremi):
# non e' piu' "a stella" rispetto a un asse dritto (la parete ripida ha normali quasi parallele all'asse) -> tubo lungo una spina curva
vase_bent = Manifold.revolve(CrossSection([prof]), 96).warp(lambda v: (v[0] + 0.05 * (v[2] - 20) ** 2, v[1], v[2]))
save(vase_bent, 'vase_bent.stl')

# 11) 3MF con due oggetti nominati e trasformazioni di build (traslazioni)
def mesh_xml(m, oid, name):
    mm = m.to_mesh(); v = mm.vert_properties[:, :3]; t = mm.tri_verts
    vs = ''.join(f'<vertex x="{a:.6f}" y="{b:.6f}" z="{c:.6f}"/>' for a, b, c in v)
    ts = ''.join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in t)
    return f'<object id="{oid}" name="{name}" type="model"><mesh><vertices>{vs}</vertices><triangles>{ts}</triangles></mesh></object>'
xml = ('<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>'
       + mesh_xml(plate, 1, 'Piastra') + mesh_xml(Manifold.cylinder(10, 4, 4, 48), 2, 'Perno')
       + '</resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 60 0 0"/></build></model>')
with zipfile.ZipFile(os.path.join(out, 'named_parts.3mf'), 'w', zipfile.ZIP_DEFLATED) as zf:
    zf.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
    zf.writestr('3D/3dmodel.model', xml)
print('named_parts.3mf')
