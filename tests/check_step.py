# Mesh2STEP — tests/check_step.py
# Versione: 1.0.0 — 2026-10-05 17:10
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
from OCP.GeomAbs import GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Sphere
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
    kinds = {'plane': 0, 'cyl': 0, 'sphere': 0, 'other': 0}
    ex = TopExp_Explorer(s, TopAbs_FACE)
    while ex.More():
        t = BRepAdaptor_Surface(TopoDS.Face(ex.Current())).GetType()
        kinds['plane' if t == GeomAbs_Plane else 'cyl' if t == GeomAbs_Cylinder else 'sphere' if t == GeomAbs_Sphere else 'other'] += 1
        ex.Next()
    nsol = 0; ex = TopExp_Explorer(s, TopAbs_SOLID)
    while ex.More(): nsol += 1; ex.Next()
    print(f'{os.path.basename(f):22s} valid={valid} solids={nsol} volume={p.Mass():.4f} faces={kinds}')
    ok_all &= valid
sys.exit(0 if ok_all else 1)
