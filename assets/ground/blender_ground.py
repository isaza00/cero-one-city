"""Ground patch for Cero One City, rendered from the game's iso camera.
A 12x12-tile continuous patch (cracked earth, ash, broken asphalt) rendered at
2x, later sliced into 64x32 diamond tiles (assets/props/slice_ground.py).
Run: blender -b -P blender_ground.py -- out.png"""
import bpy, sys, math
from mathutils import Vector

OUT = sys.argv[sys.argv.index("--")+1] if "--" in sys.argv else "ground.png"
TILES = 12
AA = 2
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"; scene.cycles.device = "CPU"
scene.cycles.samples = 64
scene.cycles.use_denoising = False
scene.cycles.sample_clamp_indirect = 3.0
scene.render.film_transparent = False
scene.render.resolution_x = TILES * 64 * AA
scene.render.resolution_y = TILES * 32 * AA
scene.render.image_settings.color_mode = "RGB"
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = -0.6

# camera: iso az 45 el 30, ortho; frame width = TILES diamonds of 64 px
AZ, EL = math.radians(45), math.radians(30)
px_per_unit = 64 / math.sqrt(2)
ortho_w = (TILES * 64) / px_per_unit
cam_data = bpy.data.cameras.new("cam"); cam_data.type = "ORTHO"; cam_data.ortho_scale = ortho_w
cam = bpy.data.objects.new("cam", cam_data); scene.collection.objects.link(cam)
cam_dir = Vector((math.cos(EL)*math.cos(AZ), math.cos(EL)*math.sin(AZ), math.sin(EL)))
cam.location = Vector((0, 0, 0)) + cam_dir * 30
cam.rotation_euler = (math.pi/2 - EL, 0, AZ + math.pi/2)
scene.camera = cam

# low sun for texture, cool dim sky
sun_data = bpy.data.lights.new("sun", "SUN"); sun_data.energy = 2.6; sun_data.angle = math.radians(4)
sun = bpy.data.objects.new("sun", sun_data); scene.collection.objects.link(sun)
sun.rotation_euler = Vector((0.9, 0.3, 0.55)).normalized().to_track_quat("Z", "Y").to_euler()
world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
wn = world.node_tree.nodes; wl = world.node_tree.links
sky = wn.new("ShaderNodeTexSky"); sky.sky_type = "NISHITA"; sky.sun_elevation = 0.45; sky.sun_intensity = 0.1; sky.dust_density = 4
wn["Background"].inputs["Strength"].default_value = 0.20
wl.new(sky.outputs["Color"], wn["Background"].inputs["Color"])

# ground plane, densely subdivided + displaced (cracks + rubble bumps)
bpy.ops.mesh.primitive_plane_add(size=ortho_w * 1.6, location=(0, 0, 0))
ground = bpy.context.object
bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.subdivide(number_cuts=260); bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.object.shade_smooth()

crack = bpy.data.textures.new("crack", "VORONOI"); crack.noise_scale = 0.62; crack.distance_metric = "DISTANCE"
crack.color_mode = "INTENSITY"; crack.noise_intensity = 1.0
d1 = ground.modifiers.new("cracks", "DISPLACE"); d1.texture = crack; d1.strength = -0.025; d1.mid_level = 0.0
bump = bpy.data.textures.new("bump", "CLOUDS"); bump.noise_scale = 0.35; bump.noise_depth = 5
d2 = ground.modifiers.new("bumps", "DISPLACE"); d2.texture = bump; d2.strength = 0.05; d2.mid_level = 0.5

# material: dark soil / ash / broken asphalt mixed by large noise masks
m = bpy.data.materials.new("ground"); m.use_nodes = True
n = m.node_tree.nodes; l = m.node_tree.links; bsdf = n["Principled BSDF"]
coord = n.new("ShaderNodeTexCoord")
big = n.new("ShaderNodeTexNoise"); big.inputs["Scale"].default_value = 0.35; big.inputs["Detail"].default_value = 4
mid = n.new("ShaderNodeTexNoise"); mid.inputs["Scale"].default_value = 3.0; mid.inputs["Detail"].default_value = 10; mid.inputs["Roughness"].default_value = 0.75
fine = n.new("ShaderNodeTexNoise"); fine.inputs["Scale"].default_value = 40.0; fine.inputs["Detail"].default_value = 6
vor = n.new("ShaderNodeTexVoronoi"); vor.inputs["Scale"].default_value = 1.6; vor.feature = "DISTANCE_TO_EDGE"
vor2 = n.new("ShaderNodeTexVoronoi"); vor2.inputs["Scale"].default_value = 4.5; vor2.feature = "DISTANCE_TO_EDGE"
for t in (big, mid, fine, vor, vor2): l.new(coord.outputs["Object"], t.inputs["Vector"])

soil = n.new("ShaderNodeValToRGB")
soil.color_ramp.elements[0].color = (0.020, 0.018, 0.016, 1); soil.color_ramp.elements[1].color = (0.10, 0.08, 0.06, 1)
l.new(mid.outputs["Fac"], soil.inputs["Fac"])
ash = n.new("ShaderNodeValToRGB")
ash.color_ramp.elements[0].color = (0.035, 0.037, 0.040, 1); ash.color_ramp.elements[1].color = (0.13, 0.13, 0.135, 1)
l.new(fine.outputs["Fac"], ash.inputs["Fac"])
asphalt = n.new("ShaderNodeValToRGB")
asphalt.color_ramp.elements[0].color = (0.012, 0.013, 0.015, 1); asphalt.color_ramp.elements[1].color = (0.05, 0.052, 0.055, 1)
l.new(fine.outputs["Fac"], asphalt.inputs["Fac"])

mask1 = n.new("ShaderNodeValToRGB"); mask1.color_ramp.elements[0].position = 0.42; mask1.color_ramp.elements[1].position = 0.58
l.new(big.outputs["Fac"], mask1.inputs["Fac"])
mixA = n.new("ShaderNodeMixRGB"); l.new(mask1.outputs["Color"], mixA.inputs["Fac"]); l.new(soil.outputs["Color"], mixA.inputs[1]); l.new(ash.outputs["Color"], mixA.inputs[2])
big2 = n.new("ShaderNodeTexNoise"); big2.inputs["Scale"].default_value = 0.22; l.new(coord.outputs["Object"], big2.inputs["Vector"])
mask2 = n.new("ShaderNodeValToRGB"); mask2.color_ramp.elements[0].position = 0.58; mask2.color_ramp.elements[1].position = 0.66
l.new(big2.outputs["Fac"], mask2.inputs["Fac"])
mixB = n.new("ShaderNodeMixRGB"); l.new(mask2.outputs["Color"], mixB.inputs["Fac"]); l.new(mixA.outputs["Color"], mixB.inputs[1]); l.new(asphalt.outputs["Color"], mixB.inputs[2])
# dark crack lines from voronoi edges
crackmask = n.new("ShaderNodeValToRGB"); crackmask.color_ramp.elements[0].position = 0.0; crackmask.color_ramp.elements[1].position = 0.025
crackmask.color_ramp.elements[0].color = (0.45, 0.45, 0.45, 1); crackmask.color_ramp.elements[1].color = (1, 1, 1, 1)
l.new(vor.outputs["Distance"], crackmask.inputs["Fac"])
crack2 = n.new("ShaderNodeValToRGB"); crack2.color_ramp.elements[0].position = 0.0; crack2.color_ramp.elements[1].position = 0.012
crack2.color_ramp.elements[0].color = (0.6, 0.6, 0.6, 1); crack2.color_ramp.elements[1].color = (1, 1, 1, 1)
l.new(vor2.outputs["Distance"], crack2.inputs["Fac"])
# las grietas finas solo en las zonas de tierra (no en asfalto)
crackboth = n.new("ShaderNodeMixRGB"); crackboth.blend_type = "MULTIPLY"; crackboth.inputs["Fac"].default_value = 1.0
l.new(crackmask.outputs["Color"], crackboth.inputs[1]); l.new(crack2.outputs["Color"], crackboth.inputs[2])
crackmask = crackboth
mixC = n.new("ShaderNodeMixRGB"); mixC.blend_type = "MULTIPLY"; mixC.inputs["Fac"].default_value = 1.0
l.new(mixB.outputs["Color"], mixC.inputs[1]); l.new(crackmask.outputs["Color"], mixC.inputs[2])
l.new(mixC.outputs["Color"], bsdf.inputs["Base Color"])
rough = n.new("ShaderNodeMath"); rough.operation = "MULTIPLY_ADD"; rough.inputs[1].default_value = -0.35; rough.inputs[2].default_value = 0.95
l.new(mask2.outputs["Color"], rough.inputs[0]); l.new(rough.outputs[0], bsdf.inputs["Roughness"])
bmp = n.new("ShaderNodeBump"); bmp.inputs["Strength"].default_value = 0.5
l.new(fine.outputs["Fac"], bmp.inputs["Height"]); l.new(bmp.outputs["Normal"], bsdf.inputs["Normal"])
ground.data.materials.append(m)

scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("RENDERED", OUT)
