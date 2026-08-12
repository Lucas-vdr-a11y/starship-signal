(function () {
  "use strict";

  var REG = {};

  function register(id, api) {
    REG[id] = api;
  }

  function findWindow(ledger, windowId) {
    var list = (ledger && ledger.windows) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === windowId) return list[i];
    }
    return null;
  }

  function activateWindow(ledger, windowId) {
    var w = findWindow(ledger, windowId);
    if (!w) return null;
    if (!w.gameId) throw new Error("window " + windowId + " has no gameId");
    if (!REG[w.gameId]) throw new Error("unknown game " + w.gameId);
    return {
      windowId: w.id,
      gameId: w.gameId,
      world: w.world,
      verb: w.verb,
      still: w.still,
      video: w.video || null,
      title: w.label || w.world,
    };
  }

  function fx(state, name) {
    if (!state.fx) state.fx = [];
    state.fx.push(name);
  }

  function takeFx(state) {
    var list = (state && state.fx) || [];
    if (state) state.fx = [];
    return list;
  }

  function start(gameId, opts) {
    var g = REG[gameId];
    if (!g) throw new Error("unknown game " + gameId);
    var state = g.start(opts || {});
    state.gameId = gameId;
    state.time = 0;
    state.over = false;
    state.won = false;
    state.fx = [];
    return state;
  }

  function input(state, ev) {
    if (!state || !state.gameId) throw new Error("game state missing gameId");
    if (state.over) return state;
    return REG[state.gameId].input(state, ev || {});
  }

  function step(state, dt) {
    if (!state || !state.gameId) throw new Error("game state missing gameId");
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    state.time += dt;
    return REG[state.gameId].step(state, dt);
  }

  function ids() {
    return Object.keys(REG);
  }

  function dirsFromShape(shape, rot) {
    var base;
    if (shape === "I") base = ["n", "s"];
    else if (shape === "L") base = ["n", "e"];
    else if (shape === "T") base = ["w", "n", "e"];
    else base = ["n", "s", "e", "w"];
    var order = ["n", "e", "s", "w"];
    var out = [];
    for (var i = 0; i < base.length; i++) {
      var idx = (order.indexOf(base[i]) + (rot % 4) + 4) % 4;
      out.push(order[idx]);
    }
    return out;
  }

  function hasDir(cell, d) {
    var ds = dirsFromShape(cell.shape, cell.rot);
    return ds.indexOf(d) !== -1;
  }

  var ARM = {
    n: { dx: 0, dy: -1 },
    e: { dx: 1, dy: 0 },
    s: { dx: 0, dy: 1 },
    w: { dx: -1, dy: 0 },
  };

  function pipeStrokeArms(cell) {
    var ds = dirsFromShape(cell.shape, cell.rot);
    var arms = [];
    for (var i = 0; i < ds.length; i++) {
      var a = ARM[ds[i]];
      arms.push({ dir: ds[i], dx: a.dx, dy: a.dy });
    }
    return arms;
  }

  register("pipebloom", {
    start: function () {
      var grid = [
        { kind: "source", shape: "I", rot: 1 },
        { kind: "pipe", shape: "L", rot: 2 },
        { kind: "pipe", shape: "I", rot: 0 },
        { kind: "plant", shape: "L", rot: 1 },
        { kind: "pipe", shape: "L", rot: 3 },
        { kind: "pipe", shape: "T", rot: 1 },
        { kind: "pipe", shape: "L", rot: 0 },
        { kind: "pipe", shape: "I", rot: 1 },
        { kind: "pipe", shape: "I", rot: 0 },
        { kind: "pipe", shape: "L", rot: 2 },
        { kind: "pipe", shape: "T", rot: 0 },
        { kind: "plant", shape: "L", rot: 3 },
        { kind: "pipe", shape: "L", rot: 1 },
        { kind: "pipe", shape: "I", rot: 1 },
        { kind: "pipe", shape: "L", rot: 0 },
        { kind: "pipe", shape: "I", rot: 0 },
      ];
      return {
        cols: 4,
        rows: 4,
        grid: grid,
        watered: 0,
        plants: 2,
        selected: 0,
      };
    },
    input: function (state, ev) {
      if (ev.type === "select" && typeof ev.index === "number") {
        if (ev.index >= 0 && ev.index < state.grid.length) state.selected = ev.index;
      }
      if (ev.type === "rotate") {
        var i = typeof ev.index === "number" ? ev.index : state.selected;
        var cell = state.grid[i];
        if (cell && cell.kind !== "source") {
          cell.rot = (cell.rot + 1) % 4;
          fx(state, "rotate");
        }
      }
      return state;
    },
    step: function (state) {
      var cols = state.cols;
      var opp = { n: "s", s: "n", e: "w", w: "e" };
      var delta = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
      var seen = {};
      var q = [];
      var i;
      for (i = 0; i < state.grid.length; i++) {
        if (state.grid[i].kind === "source") q.push(i);
      }
      var watered = 0;
      while (q.length) {
        var idx = q.shift();
        if (seen[idx]) continue;
        seen[idx] = true;
        var cell = state.grid[idx];
        if (cell.kind === "plant") watered += 1;
        var x = idx % cols;
        var y = (idx - x) / cols;
        var ds = dirsFromShape(cell.shape, cell.rot);
        for (i = 0; i < ds.length; i++) {
          var d = ds[i];
          var nx = x + delta[d][0];
          var ny = y + delta[d][1];
          if (nx < 0 || ny < 0 || nx >= cols || ny >= state.rows) continue;
          var nidx = ny * cols + nx;
          var next = state.grid[nidx];
          if (next && hasDir(next, opp[d]) && !seen[nidx]) q.push(nidx);
        }
      }
      if (watered > (state.watered || 0)) fx(state, "water");
      state.watered = watered;
      state.flow = seen;
      if (watered >= state.plants) {
        state.won = true;
        state.over = true;
      }
      return state;
    },
  });

  register("slingshot", {
    start: function () {
      return {
        holeX: 0.5,
        holeY: 0.5,
        targetX: 0.84,
        targetY: 0.28,
        targetR: 0.045,
        px: 0.14,
        py: 0.72,
        vx: 0,
        vy: 0,
        angle: -0.7,
        power: 0.55,
        launched: false,
        closest: 99,
        fuel: 1,
      };
    },
    input: function (state, ev) {
      if (state.launched) return state;
      if (ev.type === "aim" && typeof ev.angle === "number") state.angle = ev.angle;
      if (ev.type === "aimDelta" && typeof ev.da === "number") state.angle += ev.da;
      if (ev.type === "power" && typeof ev.power === "number") {
        state.power = Math.max(0.15, Math.min(1, ev.power));
      }
      if (ev.type === "powerDelta" && typeof ev.dp === "number") {
        state.power = Math.max(0.15, Math.min(1, state.power + ev.dp));
      }
      if (ev.type === "launch") {
        state.launched = true;
        state.vx = Math.cos(state.angle) * state.power * 1.15;
        state.vy = Math.sin(state.angle) * state.power * 1.15;
        fx(state, "launch");
      }
      return state;
    },
    step: function (state, dt) {
      if (!state.launched || state.over) return state;
      var dx = state.holeX - state.px;
      var dy = state.holeY - state.py;
      var r2 = dx * dx + dy * dy;
      var r = Math.sqrt(r2);
      if (r < 0.055) {
        state.over = true;
        state.won = false;
        return state;
      }
      var g = 0.22 / r2;
      state.vx += (dx / r) * g * dt;
      state.vy += (dy / r) * g * dt;
      state.px += state.vx * dt;
      state.py += state.vy * dt;
      var td = Math.hypot(state.px - state.targetX, state.py - state.targetY);
      if (td < state.closest) state.closest = td;
      if (td < state.targetR) {
        state.won = true;
        state.over = true;
      }
      if (state.px < -0.05 || state.px > 1.05 || state.py < -0.05 || state.py > 1.05) {
        state.over = true;
        state.won = false;
      }
      return state;
    },
  });

  register("drift", {
    start: function () {
      return {
        x: 0.5,
        y: 0.8,
        vx: 0,
        motes: [
          { x: 0.2, y: 0.1, r: 0.03 },
          { x: 0.7, y: -0.2, r: 0.03 },
        ],
        jellies: [{ x: 0.4, y: -0.05, r: 0.07 }],
        score: 0,
        hits: 0,
        spawn: 0,
      };
    },
    input: function (state, ev) {
      if (ev.type === "steer" && typeof ev.x === "number") state.x = Math.max(0.08, Math.min(0.92, ev.x));
      if (ev.type === "nudge" && typeof ev.dx === "number") {
        state.x = Math.max(0.08, Math.min(0.92, state.x + ev.dx));
      }
      return state;
    },
    step: function (state, dt) {
      state.spawn += dt;
      if (state.spawn > 0.9) {
        state.spawn = 0;
        if (state.motes.length < 6) {
          state.motes.push({ x: 0.1 + Math.random() * 0.8, y: -0.1, r: 0.028 });
        }
        if (state.jellies.length < 3 && Math.random() < 0.6) {
          state.jellies.push({ x: 0.15 + Math.random() * 0.7, y: -0.15, r: 0.065 });
        }
      }
      var i;
      for (i = state.motes.length - 1; i >= 0; i--) {
        state.motes[i].y += 0.22 * dt;
        if (Math.hypot(state.motes[i].x - state.x, state.motes[i].y - state.y) < 0.06) {
          state.score += 1;
          state.motes.splice(i, 1);
          fx(state, "collect");
        } else if (state.motes[i].y > 1.1) state.motes.splice(i, 1);
      }
      for (i = state.jellies.length - 1; i >= 0; i--) {
        state.jellies[i].y += 0.16 * dt;
        if (Math.hypot(state.jellies[i].x - state.x, state.jellies[i].y - state.y) < 0.08) {
          state.hits += 1;
          state.jellies.splice(i, 1);
          fx(state, "sting");
          if (state.hits >= 3) {
            state.over = true;
            state.won = false;
          }
        } else if (state.jellies[i].y > 1.15) state.jellies.splice(i, 1);
      }
      if (state.score >= 8) {
        state.won = true;
        state.over = true;
      }
      return state;
    },
  });

  register("phaseskip", {
    start: function () {
      return {
        pulses: [{ t: 0.15 }, { t: -0.45 }],
        window0: 0.72,
        window1: 0.9,
        hits: 0,
        misses: 0,
        cooldown: 0,
      };
    },
    input: function (state, ev) {
      if (ev.type !== "tap") return state;
      if (state.cooldown > 0) return state;
      var hit = false;
      for (var i = 0; i < state.pulses.length; i++) {
        var t = state.pulses[i].t;
        if (t >= state.window0 && t <= state.window1) {
          state.pulses.splice(i, 1);
          state.hits += 1;
          hit = true;
          break;
        }
      }
      if (!hit) {
        state.misses += 1;
        fx(state, "miss");
      } else {
        fx(state, "hit");
      }
      state.cooldown = 0.12;
      if (state.misses >= 3) {
        state.over = true;
        state.won = false;
      }
      if (state.hits >= 6) {
        state.won = true;
        state.over = true;
      }
      return state;
    },
    step: function (state, dt) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      var i;
      for (i = state.pulses.length - 1; i >= 0; i--) {
        state.pulses[i].t += 0.38 * dt;
        if (state.pulses[i].t > 1.05) {
          state.pulses.splice(i, 1);
          state.misses += 1;
          fx(state, "miss");
          if (state.misses >= 3) {
            state.over = true;
            state.won = false;
          }
        }
      }
      if (state.pulses.length < 2 && !state.over) {
        state.pulses.push({ t: -0.2 - Math.random() * 0.4 });
      }
      return state;
    },
  });

  register("heatband", {
    start: function () {
      return {
        temp: 0.5,
        shield: 0,
        holding: false,
        safeTime: 0,
        flux: 0.42,
      };
    },
    input: function (state, ev) {
      if (ev.type === "hold") state.holding = true;
      if (ev.type === "release") state.holding = false;
      return state;
    },
    step: function (state, dt) {
      if (state.holding) state.shield = Math.min(1, state.shield + 0.85 * dt);
      else state.shield = Math.max(0, state.shield - 0.7 * dt);
      var net = state.flux - state.shield * 0.9;
      state.temp += net * dt;
      if (state.temp < 0) state.temp = 0;
      if (state.temp > 1) state.temp = 1;
      if (state.temp >= 0.38 && state.temp <= 0.62) state.safeTime += dt;
      else state.safeTime = Math.max(0, state.safeTime - dt * 0.25);
      if (state.temp <= 0.02 || state.temp >= 0.98) {
        state.over = true;
        state.won = false;
      }
      if (state.safeTime >= 6) {
        state.won = true;
        state.over = true;
      }
      return state;
    },
  });

  register("tracelock", {
    start: function () {
      return {
        nodes: [
          { x: 0.18, y: 0.55 },
          { x: 0.38, y: 0.28 },
          { x: 0.38, y: 0.75 },
          { x: 0.62, y: 0.28 },
          { x: 0.62, y: 0.75 },
          { x: 0.84, y: 0.5 },
        ],
        edges: [
          [0, 1],
          [0, 2],
          [1, 2],
          [1, 3],
          [2, 4],
          [3, 4],
          [3, 5],
          [4, 5],
        ],
        path: [0],
      };
    },
    input: function (state, ev) {
      if (ev.type !== "pick" || typeof ev.node !== "number") return state;
      var n = ev.node;
      if (n < 0 || n >= state.nodes.length) return state;
      if (state.path.indexOf(n) !== -1) {
        fx(state, "deny");
        return state;
      }
      var last = state.path[state.path.length - 1];
      var ok = false;
      for (var i = 0; i < state.edges.length; i++) {
        var e = state.edges[i];
        if ((e[0] === last && e[1] === n) || (e[1] === last && e[0] === n)) ok = true;
      }
      if (ok) {
        state.path.push(n);
        fx(state, "lock");
      } else {
        fx(state, "deny");
      }
      if (state.path.length === state.nodes.length) {
        state.won = true;
        state.over = true;
      }
      return state;
    },
    step: function (state) {
      return state;
    },
  });

  register("ringchoir", {
    start: function () {
      return {
        pads: 4,
        sequence: [1],
        inputSeq: [],
        phase: "watch",
        watchIndex: 0,
        watchT: 0,
        level: 1,
      };
    },
    input: function (state, ev) {
      if (state.phase !== "play") return state;
      if (ev.type !== "pad" || typeof ev.pad !== "number") return state;
      state.inputSeq.push(ev.pad);
      var i = state.inputSeq.length - 1;
      fx(state, "pad:" + ev.pad);
      if (state.inputSeq[i] !== state.sequence[i]) {
        state.over = true;
        state.won = false;
        return state;
      }
      if (state.inputSeq.length === state.sequence.length) {
        if (state.sequence.length >= 6) {
          state.won = true;
          state.over = true;
        } else {
          state.sequence.push((state.sequence[state.sequence.length - 1] + 1 + (state.level % 3)) % state.pads);
          state.level += 1;
          state.inputSeq = [];
          state.phase = "watch";
          state.watchIndex = 0;
          state.watchT = 0;
          state.watchStarted = false;
        }
      }
      return state;
    },
    step: function (state, dt) {
      if (state.phase !== "watch") return state;
      if (!state.watchStarted) {
        state.watchStarted = true;
        fx(state, "pad:" + state.sequence[0]);
      }
      state.watchT += dt;
      if (state.watchT > 0.55) {
        state.watchT = 0;
        state.watchIndex += 1;
        if (state.watchIndex >= state.sequence.length) {
          state.phase = "play";
        } else {
          fx(state, "pad:" + state.sequence[state.watchIndex]);
        }
      }
      return state;
    },
  });

  register("orefall", {
    start: function () {
      return {
        aimX: 0.5,
        aimY: 0.5,
        rocks: [
          { x: 0.25, y: 0.2, r: 0.06, hp: 1 },
          { x: 0.7, y: 0.15, r: 0.07, hp: 1 },
          { x: 0.5, y: 0.05, r: 0.05, hp: 1 },
        ],
        score: 0,
        shots: 0,
        spawn: 0,
      };
    },
    input: function (state, ev) {
      if (ev.type === "aim" && typeof ev.x === "number") {
        state.aimX = Math.max(0, Math.min(1, ev.x));
        state.aimY = Math.max(0, Math.min(1, ev.y || state.aimY));
      }
      if (ev.type === "fire") {
        state.shots += 1;
        var struck = false;
        for (var i = state.rocks.length - 1; i >= 0; i--) {
          var rk = state.rocks[i];
          if (Math.hypot(rk.x - state.aimX, rk.y - state.aimY) < rk.r + 0.03) {
            rk.hp -= 1;
            struck = true;
            if (rk.hp <= 0) {
              state.score += 1;
              state.rocks.splice(i, 1);
              fx(state, "shatter");
            } else {
              fx(state, "fire");
            }
            break;
          }
        }
        if (!struck) fx(state, "fire");
      }
      if (state.score >= 8) {
        state.won = true;
        state.over = true;
      }
      return state;
    },
    step: function (state, dt) {
      state.spawn += dt;
      if (state.spawn > 1.1 && state.rocks.length < 5 && !state.over) {
        state.spawn = 0;
        state.rocks.push({
          x: 0.12 + Math.random() * 0.76,
          y: -0.08,
          r: 0.045 + Math.random() * 0.03,
          hp: 1,
        });
      }
      for (var i = state.rocks.length - 1; i >= 0; i--) {
        state.rocks[i].y += 0.12 * dt;
        if (state.rocks[i].y > 1.05) state.rocks.splice(i, 1);
      }
      return state;
    },
  });

  window.StarshipGames = {
    activateWindow: activateWindow,
    start: start,
    input: input,
    step: step,
    ids: ids,
    findWindow: findWindow,
    dirsFromShape: dirsFromShape,
    pipeStrokeArms: pipeStrokeArms,
    takeFx: takeFx,
    _reg: REG,
  };
})();
