# Mesh2STEP — tests/make_samples.py
# Versione: 1.0.0 — 2026-10-05 17:10
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
tor = trimesh.creation.torus(major_radius=20, minor_radius=5, major_sections=48, minor_sections=24)
tor.export(os.path.join(out, 'torus.obj')); print('torus.obj', len(tor.faces))
pm = plate.to_mesh(); trimesh.Trimesh(pm.vert_properties[:, :3], pm.tri_verts).export(os.path.join(out, 'plate_hole_3mf.3mf')); print('plate_hole_3mf.3mf')
bm = blk.to_mesh(); bt = trimesh.Trimesh(bm.vert_properties[:, :3], bm.tri_verts)
top = bt.face_normals[:, 2] > 0.99
bt.update_faces(~top); bt.export(os.path.join(out, 'open_block.stl')); print('open_block.stl (aperta)')
