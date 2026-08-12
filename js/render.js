(function () {
  "use strict";

  var cabin = {
    renderer: null,
    scene: null,
    camera: null,
    canvas: null,
    clock: null,
    windowMeshes: {},
    videoEls: {},
    screenCanvases: [],
    ready: false,
  };

  function texLoader() {
    return new THREE.TextureLoader();
  }

  function loadTex(url, opts) {
    opts = opts || {};
    var t = texLoader().load(url);
    t.encoding = THREE.sRGBEncoding;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
    t.anisotropy = 8;
    return t;
  }

  function steelMat(map) {
    return new THREE.MeshStandardMaterial({
      map: map,
      color: 0xd8dde3,
      metalness: 0.72,
      roughness: 0.44,
      envMapIntensity: 0.55,
    });
  }

  function setCylindricalUVs(geom, theta0, thetaLen, y0, y1, uAround, vPerMeter) {
    var uv = geom.attributes.uv;
    var i;
    for (i = 0; i < uv.count; i++) {
      var u = uv.getX(i);
      var v = uv.getY(i);
      uv.setXY(
        i,
        ((theta0 + u * thetaLen) / (Math.PI * 2)) * uAround,
        (y0 + v * (y1 - y0)) * vPerMeter
      );
    }
    uv.needsUpdate = true;
  }

  function darkSteel() {
    return new THREE.MeshStandardMaterial({
      color: 0x2a2d32,
      metalness: 0.78,
      roughness: 0.42,
    });
  }

  function makeCanvasScreen(w, h, paint) {
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var ctx = c.getContext("2d");
    paint(ctx, w, h, 0);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    cabin.screenCanvases.push({ ctx: ctx, w: w, h: h, tex: tex, paint: paint });
    return tex;
  }

  function paintTelemetry(ctx, w, h, t) {
    ctx.fillStyle = "#07090c";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#0d1a14";
    ctx.fillRect(8, 8, w - 16, h - 16);
    ctx.strokeStyle = "#3dff9a";
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = "#7CFFB2";
    ctx.font = "600 22px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("STARSHIP  ·  CREW DECK 4", 24, 42);
    ctx.font = "16px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#9aa7b5";
    ctx.fillText("ATT  LVL  ·  412.4 km", 24, 72);
    ctx.fillText("VEL  7.67 km/s", 24, 96);
    ctx.fillText("ORB  51.6°  ·  92.4 min", 24, 120);
    var phase = (t % 8) / 8;
    ctx.fillStyle = "#3dff9a";
    ctx.fillRect(24, 148, (w - 48) * (0.35 + 0.15 * Math.sin(t * 0.7)), 8);
    ctx.fillStyle = "#5a6a78";
    ctx.fillText("LIFE  OK   CABIN  21.1°C   101.2 kPa", 24, 182);
    ctx.fillStyle = phase > 0.5 ? "#3dff9a" : "#1a3d2c";
    ctx.fillText("WINDOW RING  LIVE", 24, 208);
  }

  function addLights(scene) {
    scene.add(new THREE.AmbientLight(0x2a2620, 0.62));
    var hemi = new THREE.HemisphereLight(0xc5d4e8, 0x1a1612, 0.55);
    scene.add(hemi);

    var sun = new THREE.DirectionalLight(0xfff3d4, 2.1);
    var sunAz = (315 * Math.PI) / 180;
    sun.position.set(Math.sin(sunAz) * 8, 3.2, Math.cos(sunAz) * 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 24;
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    scene.add(sun);

    var earth = new THREE.PointLight(0xc8deff, 2.2, 18, 1.2);
    var eAz = (180 * Math.PI) / 180;
    earth.position.set(Math.sin(eAz) * 3.6, 1.6, Math.cos(eAz) * 3.6);
    scene.add(earth);

    var night = new THREE.PointLight(0xffb978, 0.45, 12, 2);
    var nAz = (0 * Math.PI) / 180;
    night.position.set(Math.sin(nAz) * 3.4, 1.5, Math.cos(nAz) * 3.4);
    scene.add(night);

    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * Math.PI * 2;
      var puck = new THREE.PointLight(0xfff4e4, 0.22, 5.5, 2);
      puck.position.set(Math.sin(a) * 2.3, 2.28, Math.cos(a) * 2.3);
      scene.add(puck);
    }
  }

  function addHull(scene, mats) {
    var wallH = window.StarshipSim.CONFIG.deckClearHeight;
    var r = window.StarshipSim.CONFIG.hullRadius;

    var floor = new THREE.Mesh(
      new THREE.CircleGeometry(r - 0.02, 96),
      new THREE.MeshStandardMaterial({
        map: mats.floor,
        color: 0x9a9a9a,
        roughness: 0.82,
        metalness: 0.08,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    var ceil = new THREE.Mesh(
      new THREE.CircleGeometry(r - 0.02, 96),
      new THREE.MeshStandardMaterial({
        map: mats.ceiling,
        color: 0x888888,
        roughness: 0.7,
        metalness: 0.25,
      })
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = wallH;
    scene.add(ceil);

    var segs = 8;
    var winSpan = (18 * Math.PI) / 180;
    var bay = (Math.PI * 2) / segs;
    var sillY = 1.08;
    var lintelY = 1.88;
    var hullSteel = steelMat(mats.steel);
    hullSteel.side = THREE.BackSide;
    var U_AROUND = 5;
    var V_PER_M = 0.55;
    function wallBand(y0, y1, theta0, thetaLen, segsN) {
      var h = y1 - y0;
      var geom = new THREE.CylinderGeometry(r, r, h, segsN, 1, true, theta0, thetaLen);
      setCylindricalUVs(geom, theta0, thetaLen, y0, y1, U_AROUND, V_PER_M);
      var mesh = new THREE.Mesh(geom, hullSteel);
      mesh.position.y = y0 + h / 2;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
    wallBand(0, sillY, 0, Math.PI * 2, 96);
    wallBand(lintelY, wallH, 0, Math.PI * 2, 96);
    var nomexMat = new THREE.MeshStandardMaterial({
      map: mats.nomex,
      roughness: 0.9,
      metalness: 0.02,
      side: THREE.BackSide,
    });
    for (var i = 0; i < segs; i++) {
      var start = i * bay + winSpan / 2;
      var len = bay - winSpan;
      wallBand(sillY, lintelY, start, len, 24);
      var bStart = start + 0.04;
      var bLen = Math.max(0.08, len - 0.08);
      var bGeom = new THREE.CylinderGeometry(r - 0.045, r - 0.045, 0.88, 16, 1, true, bStart, bLen);
      setCylindricalUVs(bGeom, bStart, bLen, 0.14, 1.02, 3.2, 0.9);
      var blanket = new THREE.Mesh(bGeom, nomexMat);
      blanket.position.y = 0.58;
      scene.add(blanket);
    }

    function ring(y, tube) {
      var mesh = new THREE.Mesh(
        new THREE.TorusGeometry(r - 0.03, tube, 12, 96),
        darkSteel()
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.position.y = y;
      scene.add(mesh);
    }
    ring(0.06, 0.045);
    ring(0.98, 0.03);
    ring(1.92, 0.03);
    ring(wallH - 0.06, 0.045);
  }

  function addWindow(scene, spec, stillTex) {
    var az = (spec.azimuthDeg * Math.PI) / 180;
    var r = window.StarshipSim.CONFIG.hullRadius - 0.08;
    var y = 1.48;
    var x = Math.sin(az) * r;
    var z = Math.cos(az) * r;
    var group = new THREE.Group();
    group.position.set(x, y, z);
    group.lookAt(0, y, 0);

    function bar(w, h, d, x, y, z) {
      var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), darkSteel());
      mesh.position.set(x, y, z);
      group.add(mesh);
    }
    bar(1.42, 0.07, 0.14, 0, 0.41, 0.03);
    bar(1.42, 0.07, 0.14, 0, -0.41, 0.03);
    bar(0.07, 0.76, 0.14, -0.675, 0, 0.03);
    bar(0.07, 0.76, 0.14, 0.675, 0, 0.03);

    var plate = new THREE.Mesh(
      new THREE.PlaneGeometry(1.32, 0.76),
      new THREE.MeshBasicMaterial({ map: stillTex, color: 0xffffff })
    );
    plate.position.z = -0.02;
    group.add(plate);

    var glass = new THREE.Mesh(
      new THREE.PlaneGeometry(1.34, 0.78),
      new THREE.MeshStandardMaterial({
        color: 0xdde7f5,
        metalness: 0.05,
        roughness: 0.05,
        transparent: true,
        opacity: 0.08,
      })
    );
    glass.position.z = 0.05;
    group.add(glass);

    var sill = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.06, 0.18), darkSteel());
    sill.position.set(0, -0.44, 0.04);
    group.add(sill);

    var glow = new THREE.PointLight(0xcfe4ff, 0.55, 6.5, 2);
    glow.position.set(0, 0, 0.4);
    group.add(glow);

    var edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.36, 0.8)),
      new THREE.LineBasicMaterial({
        color: 0x3dff9a,
        transparent: true,
        opacity: 0,
      })
    );
    edge.position.z = 0.06;
    group.add(edge);

    scene.add(group);
    cabin.windowMeshes[spec.id] = {
      group: group,
      plate: plate,
      stillTex: stillTex,
      spec: spec,
      glow: glow,
      edge: edge,
    };
  }

  function setFocusedWindow(id) {
    cabin.focusedId = id || null;
    Object.keys(cabin.windowMeshes).forEach(function (wid) {
      var slot = cabin.windowMeshes[wid];
      var on = wid === cabin.focusedId;
      if (slot.edge && slot.edge.material) slot.edge.material.opacity = on ? 0.9 : 0;
      if (slot.glow) {
        slot.glow.intensity = on ? 1.35 : 0.55;
        slot.glow.color.setHex(on ? 0x3dff9a : 0xcfe4ff);
      }
    });
  }

  function addProps(scene, mats) {
    var hatch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.62, 0.08, 32),
      darkSteel()
    );
    hatch.position.y = 0.04;
    hatch.castShadow = true;
    scene.add(hatch);
    var hole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.1, 32),
      new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 1, metalness: 0 })
    );
    hole.position.y = 0.05;
    scene.add(hole);
    var rail = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.03, 8, 32),
      darkSteel()
    );
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 0.92;
    scene.add(rail);
    for (var i = 0; i < 4; i++) {
      var a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.92, 8), darkSteel());
      post.position.set(Math.sin(a) * 0.62, 0.46, Math.cos(a) * 0.62);
      scene.add(post);
    }

    function placeOnRing(azDeg, radial) {
      var az = (azDeg * Math.PI) / 180;
      return { x: Math.sin(az) * radial, z: Math.cos(az) * radial, rot: az + Math.PI };
    }

    function bench(azDeg) {
      var p = placeOnRing(azDeg, 2.05);
      var g = new THREE.Group();
      var seat = new THREE.Mesh(
        new THREE.BoxGeometry(1.15, 0.12, 0.52),
        new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.7, metalness: 0.15 })
      );
      seat.position.y = 0.46;
      seat.castShadow = true;
      g.add(seat);
      var back = new THREE.Mesh(
        new THREE.BoxGeometry(1.15, 0.58, 0.08),
        new THREE.MeshStandardMaterial({ map: mats.nomex, roughness: 0.85, metalness: 0.04 })
      );
      back.position.set(0, 0.78, -0.24);
      g.add(back);
      g.position.set(p.x, 0, p.z);
      g.rotation.y = p.rot;
      scene.add(g);
    }
    bench(22.5);
    bench(112.5);
    bench(202.5);
    bench(292.5);

    function consoleAt(azDeg) {
      var p = placeOnRing(azDeg, 2.15);
      var g = new THREE.Group();
      var body = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.92, 0.38), darkSteel());
      body.position.y = 0.46;
      body.castShadow = true;
      g.add(body);
      var screen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.7, 0.42),
        new THREE.MeshBasicMaterial({
          map: makeCanvasScreen(640, 360, paintTelemetry),
        })
      );
      screen.position.set(0, 0.72, 0.2);
      g.add(screen);
      g.position.set(p.x, 0, p.z);
      g.rotation.y = p.rot;
      scene.add(g);
    }
    consoleAt(67.5);
    consoleAt(247.5);
  }

  function bindVideo(spec) {
    if (!spec.video) return;
    var el = document.createElement("video");
    el.src = spec.video;
    el.crossOrigin = "anonymous";
    el.loop = true;
    el.muted = true;
    el.playsInline = true;
    el.preload = "auto";
    var vt = new THREE.VideoTexture(el);
    vt.encoding = THREE.sRGBEncoding;
    cabin.videoEls[spec.id] = { el: el, tex: vt, attached: false };
  }

  function tryPlayVideos() {
    Object.keys(cabin.videoEls).forEach(function (id) {
      var rec = cabin.videoEls[id];
      var p = rec.el.play();
      if (p && p.catch) p.catch(function () {});
      if (!rec.attached && rec.el.readyState >= 2) {
        var slot = cabin.windowMeshes[id];
        if (slot) {
          slot.plate.material.map = rec.tex;
          slot.plate.material.needsUpdate = true;
          rec.attached = true;
        }
      }
    });
  }

  function init(host, ledger) {
    var w = host.clientWidth || window.innerWidth;
    var h = host.clientHeight || window.innerHeight;
    var renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, true);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.physicallyCorrectLights = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x050607, 1);
    host.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0c10, 0.012);

    var camera = new THREE.PerspectiveCamera(68, w / h, 0.06, 80);
    var state0 = window.StarshipSim.createState();
    camera.position.set(state0.x, state0.y, state0.z);

    var mats = {
      steel: loadTex("assets/interior/stainless.jpg"),
      floor: loadTex("assets/interior/floor.jpg", { repeat: [3, 3] }),
      ceiling: loadTex("assets/interior/ceiling.jpg", { repeat: [2, 2] }),
      nomex: loadTex("assets/interior/nomex.jpg"),
    };

    addLights(scene);
    addHull(scene, mats);
    addProps(scene, mats);

    var bound = window.StarshipSim.bindWindows(ledger);
    bound.forEach(function (spec) {
      var still = loadTex(spec.still);
      addWindow(scene, spec, still);
      bindVideo(spec);
    });

    cabin.renderer = renderer;
    cabin.scene = scene;
    cabin.camera = camera;
    cabin.canvas = renderer.domElement;
    cabin.clock = new THREE.Clock();
    cabin.ready = true;
    cabin.canvas.id = "stage";
    return cabin;
  }

  function applyState(state) {
    if (!cabin.camera) return;
    cabin.camera.position.set(state.x, state.y, state.z);
    cabin.camera.rotation.order = "YXZ";
    cabin.camera.rotation.y = state.yaw;
    cabin.camera.rotation.x = state.pitch;
    cabin.camera.rotation.z = 0;
  }

  function resize() {
    if (!cabin.renderer || !cabin.camera) return;
    var host = cabin.canvas.parentElement;
    var w = host.clientWidth || window.innerWidth;
    var h = host.clientHeight || window.innerHeight;
    cabin.camera.aspect = w / h;
    cabin.camera.updateProjectionMatrix();
    cabin.renderer.setSize(w, h, true);
  }

  function frame() {
    if (!cabin.ready) return;
    var t = cabin.clock ? cabin.clock.getElapsedTime() : 0;
    cabin.screenCanvases.forEach(function (s) {
      s.paint(s.ctx, s.w, s.h, t);
      s.tex.needsUpdate = true;
    });
    tryPlayVideos();
    if (cabin.focusedId && cabin.windowMeshes[cabin.focusedId]) {
      var slot = cabin.windowMeshes[cabin.focusedId];
      if (slot.edge && slot.edge.material) {
        slot.edge.material.opacity = 0.45 + 0.5 * (0.5 + 0.5 * Math.sin(t * 3.4));
      }
    }
    cabin.renderer.render(cabin.scene, cabin.camera);
  }

  window.StarshipCabin = {
    init: init,
    applyState: applyState,
    resize: resize,
    frame: frame,
    tryPlayVideos: tryPlayVideos,
    setFocusedWindow: setFocusedWindow,
    getCanvas: function () {
      return cabin.canvas;
    },
    isReady: function () {
      return cabin.ready;
    },
  };
})();
