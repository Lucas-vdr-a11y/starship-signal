(function () {
  "use strict";

  var CONFIG = {
    hullDiameter: 9,
    hullRadius: 4.5,
    innerClearance: 0.32,
    eyeHeight: 1.64,
    walkSpeed: 2.35,
    sprintSpeed: 3.9,
    lookSens: 0.00215,
    pitchMin: -1.32,
    pitchMax: 1.32,
    playerRadius: 0.22,
    deckClearHeight: 2.48,
  };

  function createState() {
    return {
      x: 0,
      y: CONFIG.eyeHeight,
      z: -1.85,
      yaw: 0,
      pitch: 0.02,
      vx: 0,
      vz: 0,
    };
  }

  function look(state, dx, dy) {
    state.yaw -= dx * CONFIG.lookSens;
    state.pitch -= dy * CONFIG.lookSens;
    if (state.pitch < CONFIG.pitchMin) state.pitch = CONFIG.pitchMin;
    if (state.pitch > CONFIG.pitchMax) state.pitch = CONFIG.pitchMax;
    return state;
  }

  function wishDir(state, input) {
    var fx = -Math.sin(state.yaw);
    var fz = -Math.cos(state.yaw);
    var rx = Math.cos(state.yaw);
    var rz = -Math.sin(state.yaw);
    var wx = 0;
    var wz = 0;
    if (input && input.forward) {
      wx += fx;
      wz += fz;
    }
    if (input && input.back) {
      wx -= fx;
      wz -= fz;
    }
    if (input && input.left) {
      wx -= rx;
      wz -= rz;
    }
    if (input && input.right) {
      wx += rx;
      wz += rz;
    }
    var len = Math.hypot(wx, wz);
    if (len > 1e-8) {
      wx /= len;
      wz /= len;
    }
    return { x: wx, z: wz };
  }

  function move(state, input, dt) {
    if (!(dt > 0)) return state;
    if (dt > 0.05) dt = 0.05;
    var wish = wishDir(state, input);
    var speed = input && input.sprint ? CONFIG.sprintSpeed : CONFIG.walkSpeed;
    state.x += wish.x * speed * dt;
    state.z += wish.z * speed * dt;
    state.y = CONFIG.eyeHeight;
    return state;
  }

  function clampHull(state) {
    var maxR = CONFIG.hullRadius - CONFIG.innerClearance;
    var r = Math.hypot(state.x, state.z);
    if (r > maxR && r > 1e-8) {
      var s = maxR / r;
      state.x *= s;
      state.z *= s;
    }
    return state;
  }

  function collideObstacle(state, obstacle) {
    if (!obstacle) return state;
    if (obstacle.type === "cylinder") {
      var dx = state.x - obstacle.x;
      var dz = state.z - obstacle.z;
      var d = Math.hypot(dx, dz);
      var minD = (obstacle.radius || 0) + CONFIG.playerRadius;
      if (d < minD) {
        if (d < 1e-8) {
          state.x = obstacle.x + minD;
        } else {
          var k = minD / d;
          state.x = obstacle.x + dx * k;
          state.z = obstacle.z + dz * k;
        }
      }
      return state;
    }
    if (obstacle.type === "aabb") {
      var nx = Math.max(obstacle.minX, Math.min(state.x, obstacle.maxX));
      var nz = Math.max(obstacle.minZ, Math.min(state.z, obstacle.maxZ));
      var ddx = state.x - nx;
      var ddz = state.z - nz;
      var dd = Math.hypot(ddx, ddz);
      var pr = CONFIG.playerRadius;
      if (dd < pr) {
        if (dd < 1e-8) {
          state.z += pr;
        } else {
          var push = (pr - dd) / dd;
          state.x += ddx * push;
          state.z += ddz * push;
        }
      }
    }
    return state;
  }

  function collideHull(state, obstacles) {
    clampHull(state);
    var list = obstacles || [];
    for (var i = 0; i < list.length; i++) collideObstacle(state, list[i]);
    clampHull(state);
    return state;
  }

  function step(state, input, dt, obstacles) {
    look(state, (input && input.lookX) || 0, (input && input.lookY) || 0);
    move(state, input, dt);
    collideHull(state, obstacles);
    return state;
  }

  function lookVector(state) {
    var cp = Math.cos(state.pitch);
    return {
      x: -Math.sin(state.yaw) * cp,
      y: Math.sin(state.pitch),
      z: -Math.cos(state.yaw) * cp,
    };
  }

  function bindWindows(ledger) {
    if (!ledger || !Array.isArray(ledger.windows)) {
      throw new Error("ledger.windows required");
    }
    return ledger.windows.map(function (w) {
      if (!w || !w.id) throw new Error("window missing id");
      if (!w.still) throw new Error("window " + w.id + " missing still");
      if (typeof w.azimuthDeg !== "number") {
        throw new Error("window " + w.id + " missing azimuthDeg");
      }
      return {
        id: w.id,
        azimuthDeg: w.azimuthDeg,
        still: w.still,
        video: w.video || null,
        tool: w.tool || null,
        prompt: w.prompt || null,
        gameId: w.gameId || null,
        world: w.world || null,
        verb: w.verb || null,
        label: w.label || null,
      };
    });
  }

  function resolveWindowMedia(ledger, windowId) {
    var list = bindWindows(ledger);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === windowId) {
        return {
          still: list[i].still,
          video: list[i].video,
          hasVideo: !!list[i].video,
        };
      }
    }
    return null;
  }

  function primaryVideoWindow(ledger) {
    var list = bindWindows(ledger);
    for (var i = 0; i < list.length; i++) {
      if (list[i].video) return list[i];
    }
    return null;
  }

  function pickWindow(state, ledger) {
    var look = lookVector(state);
    var list = bindWindows(ledger);
    var best = null;
    var bestDot = 0.62;
    for (var i = 0; i < list.length; i++) {
      var az = (list[i].azimuthDeg * Math.PI) / 180;
      var wx = Math.sin(az);
      var wz = Math.cos(az);
      var dot = look.x * wx + look.z * wz;
      if (dot > bestDot) {
        bestDot = dot;
        best = list[i];
      }
    }
    return best;
  }

  function cabinObstacles() {
    function boxAt(azDeg, radial, halfW, halfD) {
      var az = (azDeg * Math.PI) / 180;
      var cx = Math.sin(az) * radial;
      var cz = Math.cos(az) * radial;
      return {
        type: "aabb",
        minX: cx - halfW,
        maxX: cx + halfW,
        minZ: cz - halfD,
        maxZ: cz + halfD,
      };
    }
    return [
      { type: "cylinder", x: 0, z: 0, radius: 0.62, id: "hatch" },
      Object.assign(boxAt(22.5, 2.05, 0.62, 0.36), { id: "bench-a" }),
      Object.assign(boxAt(112.5, 2.05, 0.62, 0.36), { id: "bench-b" }),
      Object.assign(boxAt(202.5, 2.05, 0.62, 0.36), { id: "bench-c" }),
      Object.assign(boxAt(292.5, 2.05, 0.62, 0.36), { id: "bench-d" }),
      Object.assign(boxAt(67.5, 2.15, 0.46, 0.28), { id: "console-a" }),
      Object.assign(boxAt(247.5, 2.15, 0.46, 0.28), { id: "console-b" }),
    ];
  }

  window.StarshipSim = {
    CONFIG: CONFIG,
    createState: createState,
    look: look,
    wishDir: wishDir,
    move: move,
    collideHull: collideHull,
    collideObstacle: collideObstacle,
    step: step,
    lookVector: lookVector,
    bindWindows: bindWindows,
    resolveWindowMedia: resolveWindowMedia,
    primaryVideoWindow: primaryVideoWindow,
    cabinObstacles: cabinObstacles,
    pickWindow: pickWindow,
  };
})();
