"""Blender 4.0 / Cycles: realistic environment prop, iso camera matched to
the game's 64x32 diamond (az 45, el 30, orthographic).
Run: blender -b -P blender_prop.py -- <prop_name> <out.png>"""
import bpy, sys, math, random
from mathutils import Vector

argv = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else ["vein", "out.png"]
PROP, OUT = argv[0], argv[1]
SEED = 7
random.seed(SEED)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 128
scene.cycles.use_denoising = False
scene.render.film_transparent = True
scene.render.resolution_x = 384
scene.render.resolution_y = 384
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = -0.9

# ---------------- camera: game iso (2:1 diamond) ----------------
AZ, EL = math.radians(45), math.radians(30)
SPRITE_PX, TILE_W = 128, 64
px_per_unit = TILE_W / math.sqrt(2)
ortho_w = SPRITE_PX / px_per_unit            # world units across the frame
center = Vector((0, 0, 0.40))
cam_dir = Vector((math.cos(EL)*math.cos(AZ), math.cos(EL)*math.sin(AZ), math.sin(EL)))
cam_data = bpy.data.cameras.new("cam"); cam_data.type = "ORTHO"; cam_data.ortho_scale = ortho_w
cam = bpy.data.objects.new("cam", cam_data); scene.collection.objects.link(cam)
cam.location = center + cam_dir * 20
cam.rotation_euler = (math.pi/2 - EL, 0, AZ + math.pi/2)
scene.camera = cam

# ---------------- lighting: sun + physical sky ----------------
sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 3.2; sun_data.angle = math.radians(6)      # sombras suaves
sun = bpy.data.objects.new("sun", sun_data); scene.collection.objects.link(sun)
sun_dir = Vector((0.9, 0.3, 0.75)).normalized()
sun.rotation_euler = sun_dir.to_track_quat("Z", "Y").to_euler()
world = bpy.data.worlds.new("w"); scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes; wl = world.node_tree.links
sky = wn.new("ShaderNodeTexSky"); sky.sky_type = "NISHITA"
sky.sun_elevation = math.asin(sun_dir.z); sky.sun_rotation = math.atan2(sun_dir.y, sun_dir.x)
sky.sun_intensity = 0.15; sky.dust_density = 3.0; sky.altitude = 500
bg = wn["Background"]; bg.inputs["Strength"].default_value = 0.22
wl.new(sky.outputs["Color"], bg.inputs["Color"])

# ---------------- helpers ----------------
def new_mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    return m, m.node_tree.nodes, m.node_tree.links, m.node_tree.nodes["Principled BSDF"]

def mat_rock():
    m, n, l, bsdf = new_mat("rock")
    coord = n.new("ShaderNodeTexCoord"); mapping = n.new("ShaderNodeMapping")
    l.new(coord.outputs["Object"], mapping.inputs["Vector"])
    noise = n.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 6; noise.inputs["Detail"].default_value = 12
    noise.inputs["Roughness"].default_value = 0.7
    l.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    ramp = n.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.38; ramp.color_ramp.elements[0].color = (0.020, 0.018, 0.016, 1)
    ramp.color_ramp.elements[1].position = 0.72;  ramp.color_ramp.elements[1].color = (0.20, 0.17, 0.13, 1)
    e = ramp.color_ramp.elements.new(0.55); e.color = (0.09, 0.08, 0.07, 1)
    l.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    l.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    bump = n.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.6
    vor = n.new("ShaderNodeTexVoronoi"); vor.inputs["Scale"].default_value = 25
    l.new(mapping.outputs["Vector"], vor.inputs["Vector"])
    l.new(vor.outputs["Distance"], bump.inputs["Height"])
    l.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m

def mat_ore():
    m, n, l, bsdf = new_mat("ore")
    coord = n.new("ShaderNodeTexCoord")
    noise = n.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 30; noise.inputs["Detail"].default_value = 8
    l.new(coord.outputs["Object"], noise.inputs["Vector"])
    ramp = n.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.30, 0.16, 0.05, 1)
    ramp.color_ramp.elements[1].color = (0.85, 0.55, 0.22, 1)
    l.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    l.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Metallic"].default_value = 1.0
    rr = n.new("ShaderNodeMath"); rr.operation = "MULTIPLY_ADD"; rr.inputs[1].default_value = 0.3; rr.inputs[2].default_value = 0.2
    l.new(noise.outputs["Fac"], rr.inputs[0]); l.new(rr.outputs[0], bsdf.inputs["Roughness"])
    bump = n.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.4
    l.new(noise.outputs["Fac"], bump.inputs["Height"]); l.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m

def mat_rusted_steel(rust_amount=0.6):
    m, n, l, bsdf = new_mat("rusted")
    coord = n.new("ShaderNodeTexCoord")
    noise = n.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 9; noise.inputs["Detail"].default_value = 10
    l.new(coord.outputs["Object"], noise.inputs["Vector"])
    fine = n.new("ShaderNodeTexNoise"); fine.inputs["Scale"].default_value = 60
    l.new(coord.outputs["Object"], fine.inputs["Vector"])
    mask = n.new("ShaderNodeValToRGB")
    mask.color_ramp.elements[0].position = 0.5 - rust_amount*0.25
    mask.color_ramp.elements[1].position = 0.5 + (1-rust_amount)*0.25
    l.new(noise.outputs["Fac"], mask.inputs["Fac"])
    rust = n.new("ShaderNodeValToRGB")
    rust.color_ramp.elements[0].color = (0.05, 0.022, 0.010, 1)
    rust.color_ramp.elements[1].color = (0.26, 0.11, 0.04, 1)
    l.new(fine.outputs["Fac"], rust.inputs["Fac"])
    steel = n.new("ShaderNodeRGB"); steel.outputs[0].default_value = (0.22, 0.24, 0.27, 1)
    mix = n.new("ShaderNodeMixRGB")
    l.new(mask.outputs["Color"], mix.inputs["Fac"]); l.new(steel.outputs[0], mix.inputs[1]); l.new(rust.outputs["Color"], mix.inputs[2])
    l.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    metal = n.new("ShaderNodeMath"); metal.operation = "SUBTRACT"; metal.inputs[0].default_value = 1.0
    l.new(mask.outputs["Color"], metal.inputs[1]); l.new(metal.outputs[0], bsdf.inputs["Metallic"])
    rough = n.new("ShaderNodeMath"); rough.operation = "MULTIPLY_ADD"; rough.inputs[1].default_value = 0.6; rough.inputs[2].default_value = 0.35
    l.new(mask.outputs["Color"], rough.inputs[0]); l.new(rough.outputs[0], bsdf.inputs["Roughness"])
    bump = n.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.35
    l.new(fine.outputs["Fac"], bump.inputs["Height"]); l.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m

def mat_concrete():
    m, n, l, bsdf = new_mat("concrete")
    coord = n.new("ShaderNodeTexCoord")
    noise = n.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 14; noise.inputs["Detail"].default_value = 10
    l.new(coord.outputs["Object"], noise.inputs["Vector"])
    ramp = n.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.07, 0.07, 0.065, 1); ramp.color_ramp.elements[1].color = (0.26, 0.25, 0.22, 1)
    l.new(noise.outputs["Fac"], ramp.inputs["Fac"]); l.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.95
    bump = n.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.25
    l.new(noise.outputs["Fac"], bump.inputs["Height"]); l.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m

def mat_dirt():
    m, n, l, bsdf = new_mat("dirt")
    coord = n.new("ShaderNodeTexCoord")
    noise = n.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 20; noise.inputs["Detail"].default_value = 8
    l.new(coord.outputs["Object"], noise.inputs["Vector"])
    ramp = n.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.10, 0.08, 0.06, 1); ramp.color_ramp.elements[1].color = (0.30, 0.24, 0.17, 1)
    l.new(noise.outputs["Fac"], ramp.inputs["Fac"]); l.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    return m

def displaced_rock(loc, scale, mat, seed, strength=0.18, subdiv=4):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=1.0, location=loc)
    ob = bpy.context.object; ob.scale = scale
    tex = bpy.data.textures.new(f"rk{seed}", "CLOUDS"); tex.noise_scale = 0.40; tex.noise_depth = 3; tex.noise_type = "HARD_NOISE"
    tex.noise_basis = "VORONOI_F1"
    ob.modifiers.new("disp", "DISPLACE").texture = tex
    ob.modifiers["disp"].strength = strength
    ob.rotation_euler = (random.random()*3, random.random()*3, random.random()*6)
    bpy.ops.object.shade_smooth()
    ob.data.materials.append(mat)
    return ob

def beveled_box(loc, dims, mat, rot=(0,0,0), bevel=0.02):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.object; ob.scale = dims; ob.rotation_euler = rot
    bv = ob.modifiers.new("bev", "BEVEL"); bv.width = bevel; bv.segments = 3
    ob.data.materials.append(mat)
    return ob

def cylinder(loc, r, depth, mat, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, vertices=32)
    ob = bpy.context.object; ob.rotation_euler = rot
    bpy.ops.object.shade_smooth()
    ob.data.materials.append(mat)
    return ob


def mat_simple(name, color, metallic=0.0, rough=0.6, emit=None, emit_str=0.0):
    m, n, l, bsdf = new_mat(name)
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = emit_str
    return m

def mat_paint(color):
    """pintura de carro rayada con oxido"""
    m = mat_rusted_steel(0.35)
    for node in m.node_tree.nodes:
        if node.type == "RGB":
            node.outputs[0].default_value = (*color, 1)
    return m

def mat_glass(tint=(0.55, 0.85, 0.65)):
    m, n, l, bsdf = new_mat("glass")
    bsdf.inputs["Base Color"].default_value = (*tint, 1)
    bsdf.inputs["Transmission Weight"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.0
    bsdf.inputs["IOR"].default_value = 1.0
    return m

def mat_fluid():
    """liquido de la capsula: volumen que brilla y dispersa"""
    m = bpy.data.materials.new("fluid"); m.use_nodes = True
    n = m.node_tree.nodes; l = m.node_tree.links
    n.remove(n["Principled BSDF"])
    out = n["Material Output"]
    vol = n.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (0.55, 0.95, 0.60, 1)
    vol.inputs["Density"].default_value = 0.22
    vol.inputs["Emission Strength"].default_value = 0.25
    vol.inputs["Emission Color"].default_value = (0.35, 1.0, 0.45, 1)
    l.new(vol.outputs["Volume"], out.inputs["Volume"])
    return m

def add_bool_cut(target, cutter):
    b = target.modifiers.new("cut", "BOOLEAN"); b.operation = "DIFFERENCE"; b.object = cutter
    cutter.hide_render = True; cutter.hide_viewport = True

def sphere(loc, r, mat, scale=(1,1,1), rot=(0,0,0), subdiv=4):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=r, location=loc)
    ob = bpy.context.object; ob.scale = scale; ob.rotation_euler = rot
    bpy.ops.object.shade_smooth(); ob.data.materials.append(mat)
    return ob

def torus(loc, R, r, mat, rot=(0,0,0)):
    bpy.ops.mesh.primitive_torus_add(location=loc, major_radius=R, minor_radius=r, major_segments=40, minor_segments=14)
    ob = bpy.context.object; ob.rotation_euler = rot
    bpy.ops.object.shade_smooth(); ob.data.materials.append(mat)
    return ob

def human_figure(base, mat, rot_z=0.0):
    """figura humana en posicion fetal, tumbada de lado, eje largo en X"""
    import mathutils
    bx, by, bz = base
    R = mathutils.Euler((0, 0, rot_z)).to_matrix()
    def P(dx, dy, dz):
        v = R @ mathutils.Vector((dx, dy, dz)); return (bx+v.x, by+v.y, bz+v.z)
    def Rt(rx, ry, rz): return (rx, ry, rz + rot_z)
    sphere(P(0.17, 0.0, 0.02), 0.055, mat, scale=(1, 0.9, 1.05))                     # cabeza
    cylinder(P(0.07, 0.0, 0.0), 0.058, 0.18, mat, rot=Rt(0, 1.45, 0))                  # torso
    sphere(P(-0.03, 0.0, -0.005), 0.062, mat, scale=(1, 0.9, 0.85))                    # cadera
    cylinder(P(0.04, 0.06, 0.01), 0.02, 0.15, mat, rot=Rt(0.4, 1.2, 0))                # brazo
    cylinder(P(0.03, -0.06, -0.01), 0.02, 0.15, mat, rot=Rt(-0.4, 1.2, 0))
    cylinder(P(-0.05, 0.05, -0.07), 0.027, 0.16, mat, rot=Rt(0.3, 0.5, 0))             # muslos
    cylinder(P(-0.05, -0.05, -0.07), 0.027, 0.16, mat, rot=Rt(-0.3, 0.5, 0))
    cylinder(P(0.05, 0.06, -0.10), 0.022, 0.16, mat, rot=Rt(0.2, 1.4, 0))              # pantorrillas
    cylinder(P(0.05, -0.06, -0.10), 0.022, 0.16, mat, rot=Rt(-0.2, 1.4, 0))

# ground shadow catcher
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
ground = bpy.context.object; ground.is_shadow_catcher = True
gm, gn, gl, gb = new_mat("ground"); gb.inputs["Base Color"].default_value = (0.09, 0.10, 0.12, 1)
ground.data.materials.append(gm)

ROCK, ORE, RUSTED, CONC, DIRT = mat_rock(), mat_ore(), mat_rusted_steel(0.45), mat_concrete(), mat_dirt()

# ---------------- props ----------------
if PROP == "vein":
    main = displaced_rock((0.0, 0.0, 0.16), (0.44, 0.36, 0.32), ROCK, 1, strength=0.30)
    displaced_rock((-0.30, 0.16, 0.05), (0.26, 0.22, 0.17), ROCK, 2, strength=0.22)
    displaced_rock((0.32, -0.16, 0.04), (0.22, 0.20, 0.15), ROCK, 3, strength=0.22)
    displaced_rock((0.04, -0.04, 0.42), (0.20, 0.14, 0.26), ROCK, 4, strength=0.18)
    # vetas de cobre incrustadas en la superficie de la roca principal
    for i in range(22):
        a = random.uniform(0, 6.28); e = random.uniform(0.1, 1.3)
        nx, ny, nz = math.cos(a)*math.cos(e), math.sin(a)*math.cos(e), math.sin(e)
        p = (nx*0.42, ny*0.34, 0.16 + nz*0.30)
        s_ = random.uniform(0.04, 0.10)
        displaced_rock(p, (s_, s_*0.5, s_*0.35), ORE, 10+i, strength=0.02, subdiv=3)
    beveled_box((0.26, 0.34, 0.06), (0.58, 0.09, 0.11), RUSTED, rot=(0.12, 0.05, 0.55), bevel=0.01)   # viga al frente
    beveled_box((-0.42, -0.20, 0.03), (0.16, 0.16, 0.05), RUSTED, rot=(0, 0.2, 0.9), bevel=0.005)      # placa
    for i in range(12):
        displaced_rock((random.uniform(-0.55,0.55), random.uniform(-0.55,0.55), 0.0),
                       tuple([random.uniform(0.03,0.07)]*3), DIRT if i%2 else ROCK, 30+i, strength=0.02, subdiv=2)

elif PROP == "blocked":
    beveled_box((-0.06, 0.02, 0.18), (0.72, 0.62, 0.36), CONC, rot=(0.02, -0.03, 0.05), bevel=0.03)
    beveled_box((0.03, -0.16, 0.50), (0.66, 0.50, 0.26), CONC, rot=(0.06, 0.05, -0.25), bevel=0.03)
    beveled_box((0.16, 0.14, 0.75), (0.42, 0.36, 0.20), CONC, rot=(-0.08, 0.10, 0.35), bevel=0.03)
    cylinder((0.30, -0.32, 0.55), 0.09, 1.1, CONC)                                # pilar
    for i, (dx, dy) in enumerate([(0.05,0.05),(-0.05,0.04),(0.02,-0.06)]):       # varillas
        cylinder((0.30+dx, -0.32+dy, 1.25), 0.012, 0.4, RUSTED, rot=(random.uniform(-0.4,0.4), random.uniform(-0.4,0.4), 0))
    beveled_box((-0.28, 0.32, 0.08), (0.36, 0.12, 0.12), RUSTED, rot=(0.3, 0, 0.4))  # viga caida
    for i in range(12):
        displaced_rock((random.uniform(-0.5,0.5), random.uniform(-0.5,0.5), 0.0),
                       tuple([random.uniform(0.03,0.09)]*3), CONC, 40+i, strength=0.02, subdiv=2)

elif PROP == "scrap":
    STEEL = mat_simple("steel", (0.18, 0.19, 0.21), metallic=1.0, rough=0.45)
    PAINT = mat_paint((0.20, 0.05, 0.04))
    RUBBER = mat_simple("rubber", (0.02, 0.02, 0.02), rough=0.9)
    LED = mat_simple("led", (0.1, 0.1, 0.1), emit=(1.0, 0.25, 0.15), emit_str=8.0)
    displaced_rock((0.02, 0.0, -0.02), (0.36, 0.32, 0.14), DIRT, 5, strength=0.08)       # monticulo base
    # --- puerta de carro con ventana, apoyada de lado ---
    door = beveled_box((0.05, 0.40, 0.20), (0.06, 0.62, 0.40), PAINT, rot=(0.25, 0.0, 0.25), bevel=0.015)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0.05, 0.40, 0.31)); win = bpy.context.object
    win.scale = (0.2, 0.36, 0.16); win.rotation_euler = (0.25, 0.0, 0.25); add_bool_cut(door, win)
    cylinder((0.08, 0.22, 0.14), 0.012, 0.08, STEEL, rot=(0.25, 1.3, 0.25))
    # --- rack de servidores destruido, inclinado ---
    rx, ry, rz = -0.28, -0.05, 0.0; tilt = (0.55, 0.15, 0.7)
    for (dx, dy) in ((-0.10,-0.10),(0.10,-0.10),(-0.10,0.10),(0.10,0.10)):
        beveled_box((rx+dx, ry+dy, rz+0.34), (0.025, 0.025, 0.70), RUSTED, rot=tilt, bevel=0.004)
    for k in range(4):
        beveled_box((rx, ry, rz+0.08+k*0.17), (0.22, 0.22, 0.012), RUSTED, rot=tilt, bevel=0.003)
    beveled_box((rx, ry, rz+0.26), (0.20, 0.20, 0.10), STEEL, rot=tilt, bevel=0.005)      # servidor que quedo
    for k in range(3):
        beveled_box((rx+0.10, ry-0.06+k*0.05, rz+0.28), (0.01, 0.015, 0.015), LED, rot=tilt, bevel=0.001)
    # --- craneo de acero (con cuencas) ---
    SKULLM = mat_simple("skullm", (0.42, 0.44, 0.47), metallic=1.0, rough=0.38)
    sk = (0.36, 0.40, 0.15)
    skull = sphere(sk, 0.15, SKULLM, scale=(1.0, 0.92, 1.08), rot=(0.35, 0.15, 0.785))
    bpy.ops.mesh.primitive_cube_add(size=1, location=(sk[0], sk[1], 0.0)); jaw = bpy.context.object
    jaw.scale = (0.5, 0.5, 0.10); add_bool_cut(skull, jaw)                                 # mandibula arrancada
    for (dx, dy) in ((0.10, 0.03), (0.03, 0.10)):                                          # cuencas hacia la camara
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.048, location=(sk[0]+dx, sk[1]+dy, sk[2]+0.05))
        add_bool_cut(skull, bpy.context.object)
    beveled_box((sk[0]+0.09, sk[1]+0.09, sk[2]+0.045), (0.012, 0.012, 0.012), LED, rot=(0,0,0.785), bevel=0.001)  # ojo agonizante
    # --- llanta ---
    torus((-0.10, 0.36, 0.13), 0.13, 0.05, RUBBER, rot=(1.3, 0.2, 0.4))
    cylinder((-0.10, 0.36, 0.13), 0.08, 0.06, RUSTED, rot=(1.3, 0.2, 0.4))                # rin
    # --- placas, tubos, cables ---
    beveled_box((0.05, 0.05, 0.28), (0.30, 0.22, 0.02), RUSTED, rot=(0.5, 0.2, 1.1), bevel=0.004)
    beveled_box((-0.35, 0.28, 0.06), (0.25, 0.18, 0.02), STEEL, rot=(0.1, 0.4, 0.3), bevel=0.004)
    cylinder((0.30, -0.10, 0.30), 0.025, 0.55, RUSTED, rot=(0.9, 0.2, 0.1))
    for i in range(6):
        cylinder((random.uniform(-0.3,0.3), random.uniform(-0.3,0.3), 0.02), 0.006, random.uniform(0.2,0.45),
                 RUBBER, rot=(random.uniform(0,1.5), random.uniform(0,1.5), random.uniform(0,6)))
    for i in range(10):
        s_ = random.uniform(0.04, 0.10)
        beveled_box((random.uniform(-0.45,0.45), random.uniform(-0.45,0.45), 0.02),
                    (s_, s_*random.uniform(0.5,1.2), s_*random.uniform(0.2,0.5)), RUSTED if i%2 else STEEL,
                    rot=(random.uniform(0,3), random.uniform(0,3), random.uniform(0,6)), bevel=0.004)

elif PROP == "pod":
    scene.cycles.samples = 256
    scene.cycles.sample_clamp_indirect = 2.0
    scene.cycles.sample_clamp_direct = 6.0
    scene.cycles.volume_step_rate = 0.5
    import mathutils
    GLASS = mat_glass(tint=(0.98, 0.86, 0.86)); FLUID = mat_fluid()
    for node in FLUID.node_tree.nodes:
        if node.type == "PRINCIPLED_VOLUME":
            node.inputs["Color"].default_value = (1.0, 0.30, 0.26, 1)
            node.inputs["Density"].default_value = 0.018
            node.inputs["Emission Color"].default_value = (1.0, 0.22, 0.16, 1)
            node.inputs["Emission Strength"].default_value = 0.22
    SKIN  = mat_simple("skin", (0.88, 0.86, 0.82), rough=0.5)
    DSTEEL = mat_simple("dsteel", (0.10, 0.11, 0.13), metallic=1.0, rough=0.42)
    WHITE = mat_simple("poly", (0.72, 0.74, 0.76), rough=0.35)
    GLOW  = mat_simple("glow", (0.1, 0.05, 0.05), emit=(1.0, 0.25, 0.18), emit_str=7.0)
    CABLE = mat_simple("cable", (0.05, 0.05, 0.06), rough=0.6)

    def human_standing(base, mat, rot_z=0.0, h=0.50):
        bx, by, bz = base; u = h / 1.75
        R = mathutils.Euler((0, 0, rot_z)).to_matrix()
        def P(dx, dy, dz):
            v = R @ mathutils.Vector((dx*u, dy*u, dz*u)); return (bx+v.x, by+v.y, bz+v.z)
        def Rt(rx, ry, rz): return (rx, ry, rz + rot_z)
        sphere(P(0.05, 0, 1.58), 0.115*u, mat, scale=(0.85, 0.9, 1.05), rot=Rt(0.35, 0, 0))
        cylinder(P(0.03, 0, 1.44), 0.05*u, 0.12*u, mat, rot=Rt(0.2, 0, 0))
        sphere(P(0, 0, 1.30), 0.19*u, mat, scale=(1.05, 0.65, 0.75))
        cylinder(P(0, 0, 1.08), 0.13*u, 0.45*u, mat)
        sphere(P(0, 0, 0.86), 0.16*u, mat, scale=(1.0, 0.7, 0.6))
        for sgn in (1, -1):
            cylinder(P(0.02, sgn*0.24, 1.10), 0.045*u, 0.32*u, mat, rot=Rt(sgn*0.12, 0.08, 0))
            cylinder(P(0.06, sgn*0.27, 0.80), 0.04*u, 0.30*u, mat, rot=Rt(sgn*0.05, 0.12, 0))
            sphere(P(0.09, sgn*0.28, 0.63), 0.05*u, mat, scale=(0.7, 0.6, 1.1))
            cylinder(P(0, sgn*0.10, 0.62), 0.075*u, 0.48*u, mat, rot=Rt(sgn*0.04, 0.03, 0))
            cylinder(P(0.01, sgn*0.11, 0.20), 0.055*u, 0.42*u, mat, rot=Rt(sgn*0.02, 0.04, 0))
            sphere(P(0.06, sgn*0.11, 0.0), 0.06*u, mat, scale=(1.6, 0.8, 0.5))

    def pod_horizontal(cx, cy, r=0.20, L=0.78, with_human=True, axis_angle=-0.785):
        """capsula acostada: se construye vertical y se gira 90 grados"""
        before = set(bpy.data.objects)
        # capsula vertical en el origen
        cylinder((0, 0, L/2), r, L, GLASS)
        cylinder((0, 0, L/2), r*0.965, L*0.985, FLUID)
        for k in range(3):                                            # montantes
            a = k*2.094 + 1.2
            cylinder((math.cos(a)*r*1.02, math.sin(a)*r*1.02, L/2), 0.012, L, DSTEEL)
        for zc in (0.0, L):                                            # tapas
            cylinder((0, 0, zc), r*1.16, 0.07, DSTEEL)
            cylinder((0, 0, zc + (0.045 if zc == 0 else -0.045)), r*1.05, 0.012, GLOW)
        torus((0, 0, L/2), r*1.04, 0.022, WHITE)                      # aro central (anillo, no disco)
        if with_human:
            # de pie -> al girar queda tumbado, mirando hacia arriba/camara
            human_standing((0, 0, 0.05), SKIN, rot_z=-1.5708, h=L*0.92)
            ld = bpy.data.lights.new("pl", "POINT"); ld.energy = 1.4; ld.color = (1.0, 0.85, 0.8); ld.shadow_soft_size = 0.005
            lo = bpy.data.objects.new("pl", ld); scene.collection.objects.link(lo)
            lo.location = (0.0, 0.11, L*0.5)
            lo.visible_camera = False
        created = [o for o in bpy.data.objects if o not in before]
        # girar todo el grupo 90 grados para acostarlo, y levantarlo sobre la cuna
        piv = bpy.data.objects.new("piv", None); scene.collection.objects.link(piv)
        for o in created:
            o.parent = piv
        D = mathutils.Vector((math.cos(axis_angle), math.sin(axis_angle), 0)).normalized()   # eje deseado
        rot = mathutils.Vector((0, 0, 1)).rotation_difference(D).to_matrix().to_4x4()
        piv.matrix_world = mathutils.Matrix.Translation((cx, cy, r + 0.14)) @ rot
        ax = D
        for t in (-0.32, 0.32):                                        # soportes de la cuna
            p = mathutils.Vector((cx, cy, 0)) + ax*t*L
            beveled_box((p.x, p.y, 0.08), (r*2.4, 0.10, 0.16), DSTEEL, rot=(0, 0, axis_angle+1.5708), bevel=0.01)
            beveled_box((p.x, p.y, 0.17), (r*1.6, 0.06, 0.02), GLOW, rot=(0, 0, axis_angle+1.5708), bevel=0.001)
        # cables de la tapa trasera al suelo
        p_end = mathutils.Vector((cx, cy, r + 0.14)) + ax*(L*0.55)
        for k in range(3):
            q = p_end + ax*0.08*k
            cylinder((q.x, q.y, (r+0.14)/2), 0.014, r + 0.14, CABLE)

    pod_horizontal(0.02, 0.02)                                          # principal, perpendicular a camara
    pod_horizontal(-0.40, 0.42, r=0.12, L=0.50, with_human=True, axis_angle=-0.785)   # detras
    beveled_box((0, 0, 0.012), (1.20, 1.20, 0.025), DSTEEL, rot=(0,0,0.785), bevel=0.01)   # placa de suelo
    for k in range(4):
        a = k*1.5708 + 0.785
        beveled_box((math.cos(a)*0.52, math.sin(a)*0.52, 0.03), (0.02, 0.10, 0.008), GLOW, rot=(0,0,a), bevel=0.001)
    beveled_box((0.40, -0.38, 0.22), (0.07, 0.10, 0.40), DSTEEL, bevel=0.005)            # consola
    beveled_box((0.42, -0.38, 0.30), (0.012, 0.07, 0.14), GLOW, bevel=0.001)

elif PROP == "rubble":
    displaced_rock((-0.10, 0.06, -0.06), (0.34, 0.30, 0.16), DIRT, 50, strength=0.10)
    displaced_rock((0.24, -0.20, -0.08), (0.24, 0.22, 0.12), DIRT, 51, strength=0.10)
    for i in range(16):
        s_ = random.uniform(0.05, 0.14)
        m = [CONC, CONC, RUSTED, ROCK][random.randint(0, 3)]
        beveled_box((random.uniform(-0.45,0.45), random.uniform(-0.45,0.45), random.uniform(0.0,0.10)),
                    (s_, s_*random.uniform(0.6,1.3), s_*random.uniform(0.3,0.8)), m,
                    rot=(random.uniform(0,0.8), random.uniform(0,0.8), random.uniform(0,6)), bevel=0.006)
    cylinder((-0.10, 0.30, 0.04), 0.02, 0.62, RUSTED, rot=(0.15, 1.45, 0.3))               # riel torcido
    cylinder((0.20, 0.12, 0.03), 0.015, 0.40, RUSTED, rot=(0.1, 1.5, -0.6))
    beveled_box((0.30, 0.30, 0.03), (0.28, 0.20, 0.03), CONC, rot=(0.05, 0.12, 0.5), bevel=0.005) # losa partida
    for i in range(10):
        displaced_rock((random.uniform(-0.5,0.5), random.uniform(-0.5,0.5), 0.0),
                       tuple([random.uniform(0.02,0.05)]*3), ROCK, 60+i, strength=0.02, subdiv=2)

elif PROP == "deadland_a":
    cylinder((0.0, 0.0, 0.45), 0.17, 0.90, CONC)                                            # tocon de torre
    cylinder((0.0, 0.0, 0.98), 0.13, 0.20, CONC)
    for k in range(5):                                                                        # varillas al aire
        a = k*1.25
        cylinder((math.cos(a)*0.09, math.sin(a)*0.09, 1.30), 0.012, 0.50, RUSTED,
                 rot=(random.uniform(-0.5,0.5), random.uniform(-0.5,0.5), 0))
    beveled_box((0, 0, 0.04), (0.70, 0.70, 0.08), CONC, bevel=0.01)                          # base
    beveled_box((0.30, -0.30, 0.10), (0.26, 0.18, 0.12), CONC, rot=(0.2, 0.1, 0.4), bevel=0.01)
    for i in range(8):
        displaced_rock((random.uniform(-0.5,0.5), random.uniform(-0.5,0.5), 0.0),
                       tuple([random.uniform(0.03,0.08)]*3), CONC, 70+i, strength=0.02, subdiv=2)

elif PROP == "deadland_b":
    STEELB = mat_simple("steelb", (0.16, 0.17, 0.19), metallic=1.0, rough=0.5)
    beveled_box((0.0, 0.0, 0.10), (1.00, 0.16, 0.16), RUSTED, rot=(0.0, 0.0, 0.5), bevel=0.01)   # mastil caido
    for k in range(4):                                                                        # travesaños
        t = -0.35 + k*0.23
        beveled_box((math.cos(0.5)*t, math.sin(0.5)*t, 0.10), (0.03, 0.42, 0.03), RUSTED, rot=(0,0,0.5), bevel=0.003)
    cylinder((-0.30, 0.25, 0.18), 0.05, 0.36, STEELB)                                        # cabezal
    sphere((-0.30, 0.25, 0.42), 0.07, mat_simple("dead", (0.30, 0.06, 0.04), rough=0.4))     # baliza apagada
    beveled_box((0.42, -0.28, 0.06), (0.22, 0.16, 0.12), CONC, rot=(0.1, 0.05, 0.3), bevel=0.01)
    for i in range(8):
        displaced_rock((random.uniform(-0.5,0.5), random.uniform(-0.5,0.5), 0.0),
                       tuple([random.uniform(0.03,0.07)]*3), DIRT, 80+i, strength=0.02, subdiv=2)

bpy.ops.object.select_all(action="DESELECT")
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("RENDERED", OUT)
