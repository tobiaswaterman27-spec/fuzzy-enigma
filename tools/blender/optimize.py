"""Cuts triangle counts of exported models:
python tools/blender/optimize.py <ratio> a.glb b.glb ...
Vertices split only by the export are welded first, then every mesh is collapse-decimated to `ratio`
of its triangles (flat areas go first, so silhouettes and material borders hold). Rewritten in place."""
import sys
import bpy

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
ratio = float(args[0])
for path in [a for a in args[1:] if a.endswith('.glb')]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path, merge_vertices=True)
    before = after = 0
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            continue
        o.data.calc_loop_triangles()
        n = len(o.data.loop_triangles)
        before += n
        if n > 150:
            bpy.context.view_layer.objects.active = o
            m = o.modifiers.new('dec', 'DECIMATE')
            m.decimate_type = 'COLLAPSE'
            m.ratio = ratio
            m.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=m.name)
            # decimation scrambles the imported custom normals: shade again, smooth within 35 degrees
            for x in bpy.context.selected_objects:
                x.select_set(False)
            o.select_set(True)
            with bpy.context.temp_override(selected_editable_objects=[o], object=o, active_object=o):
                if o.data.has_custom_normals:
                    bpy.ops.mesh.customdata_custom_splitnormals_clear()
                bpy.ops.object.shade_smooth_by_angle(angle=0.61)
        o.data.calc_loop_triangles()
        after += len(o.data.loop_triangles)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True)
    print(f'{path}: {before} -> {after} triangles')
