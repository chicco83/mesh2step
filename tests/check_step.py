# Mesh2STEP — tests/check_step.py
# Versione: 1.3.0 — 2026-10-06 13:40  [conta anche coni, tori, B-spline]
# Verifica gli STEP con OpenCASCADE (OCP): lettura, validità B-rep, volume, conteggio tipi di superficie.
import sys, glob, os
from OCP.STEPControl import STEPControl_Reader
from OCP.IFSelect import IFSelect_RetDone
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Sphere, GeomAbs_Cone, GeomAbs_Torus, GeomAbs_BSplineSurface
from OCP.TopoDS import TopoDS

d = sys.argv[1] if len(sys.argv) > 1 else 'tests/out'
ok_all = True
for f in sorted(glob.glob(os.path.join(d, '*.step'))):
    r = STEPControl_Reader()
    if r.ReadFile(f) != IFSelect_RetDone:
        print(os.path.basename(f), 'LETTURA FALLITA'); ok_all = False; continue
    r.TransferRoots(); s = r.OneShape()
    valid = BRepCheck_Analyzer(s).IsValid()
    p = GProp_GProps(); BRepGProp.VolumeProperties_s(s, p)
    # [2026-10-06] prima: solo plane/cyl/sphere/other
    kinds = {'plane': 0, 'cyl': 0, 'cone': 0, 'sphere': 0, 'torus': 0, 'bspline': 0, 'other': 0}
    KIND = {GeomAbs_Plane: 'plane', GeomAbs_Cylinder: 'cyl', GeomAbs_Cone: 'cone', GeomAbs_Sphere: 'sphere', GeomAbs_Torus: 'torus', GeomAbs_BSplineSurface: 'bspline'}
    ex = TopExp_Explorer(s, TopAbs_FACE)
    while ex.More():
        t = BRepAdaptor_Surface(TopoDS.Face(ex.Current())).GetType()
        kinds[KIND.get(t, 'other')] += 1
        ex.Next()
    nsol = 0; ex = TopExp_Explorer(s, TopAbs_SOLID)
    while ex.More(): nsol += 1; ex.Next()
    print(f'{os.path.basename(f):22s} valid={valid} solids={nsol} volume={p.Mass():.4f} faces={ {k: v for k, v in kinds.items() if v} }')
    ok_all &= valid
sys.exit(0 if ok_all else 1)
