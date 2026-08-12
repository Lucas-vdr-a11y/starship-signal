(function () {
  "use strict";

  var assets = { stills: {}, sprites: {}, videos: {} };
  var FONT = '"IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';
  var HELP = {
    pipebloom: "Click a tile to rotate it. Route water to every plant.",
    slingshot: "A/D aim  ·  W/S power  ·  Space to launch  ·  hit the beacon",
    drift: "A/D steer the probe  ·  collect motes  ·  avoid the jellies",
    phaseskip: "Press Space when the pulse is inside the bright band.",
    heatband: "Hold Space to raise the veil. Keep heat in the green band.",
    tracelock: "Click nodes. Walk every junction exactly once.",
    ringchoir: "Watch the pads light up, then click them in order.",
    orefall: "Move the aim. Click to fire. Shatter eight rocks.",
  };
  var RESULT = {
    pipebloom: {
      win: "Water reached every plant. The garden holds.",
    },
    slingshot: {
      win: "Beacon locked. The slingshot held.",
      lose: "The probe was lost to the gravity well.",
    },
    drift: {
      win: "Eight motes collected. The reef is charted.",
      lose: "The jellies took the probe.",
    },
    phaseskip: {
      win: "Six pulses caught. The lane is open.",
      lose: "Too many pulses missed the window.",
    },
    heatband: {
      win: "Heat held in the green band. The veil is stable.",
      lose: "Temperature left the safe band.",
    },
    tracelock: {
      win: "Every junction walked once. Trace locked.",
    },
    ringchoir: {
      win: "The sequence is complete. The rings answer.",
      lose: "Wrong pad. The choir fell silent.",
    },
    orefall: {
      win: "Eight rocks shattered. The belt is clear.",
    },
  };

  function setType(ctx, weight, size) {
    ctx.font = weight + " " + size + "px " + FONT;
  }

  function write(ctx, text, x, y) {
    ctx.fillText(text, Math.round(x), Math.round(y));
  }

  function syncCanvas(canvas) {
    if (!canvas) return { w: 1280, h: 720, dpr: 1 };
    var dpr = window.devicePixelRatio || 1;
    if (dpr < 1) dpr = 1;
    if (dpr > 3) dpr = 3;
    var cssW = canvas.clientWidth || canvas.width || 1280;
    var cssH = canvas.clientHeight || canvas.height || 720;
    if (cssW < 1) cssW = 1280;
    if (cssH < 1) cssH = 720;
    var bw = Math.round(cssW * dpr);
    var bh = Math.round(cssH * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    return { w: cssW, h: cssH, dpr: dpr };
  }

  function logicalSize(canvas) {
    if (!canvas) return { w: 1280, h: 720 };
    return {
      w: canvas.clientWidth || canvas.width || 1280,
      h: canvas.clientHeight || canvas.height || 720,
    };
  }

  function pipeLayout(state, w, h) {
    var cell = Math.min((w - 200) / state.cols, (h - 180) / state.rows);
    return {
      cell: cell,
      ox: (w - cell * state.cols) / 2,
      oy: 96,
    };
  }

  function resultCopy(state, bind) {
    var row = (state && RESULT[state.gameId]) || {};
    var title = state && state.won ? "You won" : "You lost";
    var body = state && state.won ? row.win : row.lose;
    if (!body) body = state && state.won ? "This window is clear." : "This attempt failed.";
    return {
      kicker: (bind && (bind.title || bind.world)) || "Window",
      title: title,
      body: body,
      won: !!(state && state.won),
    };
  }

  function loadImage(src) {
    var img = new Image();
    img.src = src;
    return img;
  }

  function prepare(ledger) {
    var list = (ledger && ledger.windows) || [];
    for (var i = 0; i < list.length; i++) {
      assets.stills[list[i].id] = loadImage(list[i].still);
      if (list[i].video) {
        var v = document.createElement("video");
        v.src = list[i].video;
        v.loop = true;
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        assets.videos[list[i].id] = v;
      }
    }
    assets.sprites.probe = loadImage("assets/games/probe.png");
    assets.sprites.asteroid = loadImage("assets/games/asteroid.png");
    return assets;
  }

  function bg(ctx, w, h, windowId) {
    var vid = assets.videos[windowId];
    if (vid && vid.readyState >= 2) {
      try {
        vid.play();
      } catch (e) {
        void e;
      }
      ctx.drawImage(vid, 0, 0, w, h);
      return;
    }
    var img = assets.stills[windowId];
    if (img && img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, w, h);
    else {
      ctx.fillStyle = "#0a0c10";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = "rgba(5,6,7,0.28)";
    ctx.fillRect(0, 0, w, h);
  }

  function label(ctx, w, h, title, help, state, stats) {
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(5,6,7,0.66)";
    ctx.fillRect(0, 0, w, 88);
    ctx.fillRect(0, h - 68, w, 68);
    ctx.fillStyle = "#f3f6f8";
    setType(ctx, "600", 30);
    write(ctx, title, 28, 40);
    ctx.fillStyle = "#c5cdd4";
    setType(ctx, "400", 17);
    write(ctx, help, 28, 68);
    if (!state.over) {
      ctx.fillStyle = "#3dff9a";
      setType(ctx, "500", 15);
      write(ctx, "LIVE", 28, h - 28);
      if (stats) {
        ctx.fillStyle = "#f3f6f8";
        write(ctx, stats, 108, h - 28);
      }
    }
    ctx.restore();
  }

  function statsLine(state) {
    var gid = state.gameId;
    if (gid === "drift") return "Motes " + state.score + " / 8   Hits " + state.hits + " / 3";
    if (gid === "phaseskip") return "Hits " + state.hits + " / 6   Misses " + state.misses + " / 3";
    if (gid === "heatband") return "Veil " + Math.round(state.shield * 100) + "%   Safe " + state.safeTime.toFixed(1) + "s / 6s";
    if (gid === "ringchoir") return (state.phase === "play" ? "Your turn" : "Watch") + "  ·  Level " + state.level;
    if (gid === "orefall") return "Ore " + state.score + " / 8";
    if (gid === "pipebloom") return "Plants " + (state.watered || 0) + " / " + state.plants;
    if (gid === "tracelock") return "Nodes " + state.path.length + " / " + state.nodes.length;
    return "";
  }

  function draw(ctx, bind, state) {
    var size = syncCanvas(ctx.canvas);
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = "high";
    var w = size.w;
    var h = size.h;
    bg(ctx, w, h, bind.windowId);
    var gid = state.gameId;
    if (gid === "pipebloom") drawPipes(ctx, w, h, state);
    else if (gid === "slingshot") drawSling(ctx, w, h, state);
    else if (gid === "drift") drawDrift(ctx, w, h, state);
    else if (gid === "phaseskip") drawPulse(ctx, w, h, state);
    else if (gid === "heatband") drawHeat(ctx, w, h, state);
    else if (gid === "tracelock") drawTrace(ctx, w, h, state);
    else if (gid === "ringchoir") drawChoir(ctx, w, h, state);
    else if (gid === "orefall") drawOre(ctx, w, h, state);
    label(ctx, w, h, bind.title || bind.world, HELP[gid] || "", state, statsLine(state));
  }

  function drawPipes(ctx, w, h, state) {
    var layout = pipeLayout(state, w, h);
    var cell = layout.cell;
    var ox = layout.ox;
    var oy = layout.oy;
    for (var i = 0; i < state.grid.length; i++) {
      var x = i % state.cols;
      var y = (i - x) / state.cols;
      var px = ox + x * cell;
      var py = oy + y * cell;
      ctx.fillStyle = state.flow && state.flow[i] ? "rgba(61,255,154,0.22)" : "rgba(8,10,14,0.7)";
      ctx.fillRect(px + 4, py + 4, cell - 8, cell - 8);
      ctx.strokeStyle = i === state.selected ? "#3dff9a" : "rgba(232,237,242,0.25)";
      ctx.lineWidth = i === state.selected ? 3 : 1;
      ctx.strokeRect(px + 4, py + 4, cell - 8, cell - 8);
      ctx.save();
      ctx.translate(px + cell / 2, py + cell / 2);
      ctx.strokeStyle = "#e8edf2";
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.beginPath();
      var arms = window.StarshipGames.pipeStrokeArms(state.grid[i]);
      var reach = cell * 0.28;
      for (var a = 0; a < arms.length; a++) {
        ctx.moveTo(0, 0);
        ctx.lineTo(arms[a].dx * reach, arms[a].dy * reach);
      }
      ctx.stroke();
      ctx.restore();
      if (state.grid[i].kind === "source") {
        ctx.fillStyle = "#4db3ff";
        ctx.fillRect(px + cell * 0.35, py + cell * 0.35, cell * 0.3, cell * 0.3);
      }
      if (state.grid[i].kind === "plant") {
        ctx.fillStyle = "#3dff9a";
        ctx.beginPath();
        ctx.arc(px + cell / 2, py + cell / 2, 8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawSling(ctx, w, h, state) {
    ctx.fillStyle = "rgba(255,160,60,0.18)";
    ctx.beginPath();
    ctx.arc(state.holeX * w, state.holeY * h, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffb25a";
    ctx.beginPath();
    ctx.arc(state.holeX * w, state.holeY * h, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#3dff9a";
    ctx.beginPath();
    ctx.arc(state.targetX * w, state.targetY * h, state.targetR * w, 0, Math.PI * 2);
    ctx.fill();
    var px = state.px * w;
    var py = state.py * h;
    var spr = assets.sprites.probe;
    if (spr && spr.complete && spr.naturalWidth) ctx.drawImage(spr, px - 22, py - 22, 44, 44);
    else {
      ctx.fillStyle = "#e8edf2";
      ctx.fillRect(px - 6, py - 6, 12, 12);
    }
    if (!state.launched) {
      ctx.strokeStyle = "#e8edf2";
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(state.angle) * state.power * 140, py + Math.sin(state.angle) * state.power * 140);
      ctx.stroke();
    }
  }

  function drawDrift(ctx, w, h, state) {
    var i;
    ctx.fillStyle = "#7CFFB2";
    for (i = 0; i < state.motes.length; i++) {
      ctx.beginPath();
      ctx.arc(state.motes[i].x * w, state.motes[i].y * h, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,210,80,0.75)";
    for (i = 0; i < state.jellies.length; i++) {
      ctx.beginPath();
      ctx.arc(state.jellies[i].x * w, state.jellies[i].y * h, state.jellies[i].r * w, 0, Math.PI * 2);
      ctx.fill();
    }
    var spr = assets.sprites.probe;
    if (spr && spr.complete) ctx.drawImage(spr, state.x * w - 28, state.y * h - 28, 56, 56);
    else {
      ctx.fillStyle = "#e8edf2";
      ctx.fillRect(state.x * w - 10, state.y * h - 10, 20, 20);
    }
  }

  function drawPulse(ctx, w, h, state) {
    ctx.fillStyle = "rgba(61,255,154,0.16)";
    ctx.fillRect(state.window0 * w, h * 0.35, (state.window1 - state.window0) * w, h * 0.3);
    ctx.strokeStyle = "#3dff9a";
    ctx.strokeRect(state.window0 * w, h * 0.35, (state.window1 - state.window0) * w, h * 0.3);
    for (var i = 0; i < state.pulses.length; i++) {
      var x = state.pulses[i].t * w;
      ctx.fillStyle = "#7cf0ff";
      ctx.fillRect(x - 6, h * 0.32, 12, h * 0.36);
    }
  }

  function drawHeat(ctx, w, h, state) {
    var barX = w * 0.18;
    var barW = w * 0.64;
    ctx.fillStyle = "rgba(8,10,14,0.7)";
    ctx.fillRect(barX, h * 0.62, barW, 28);
    ctx.fillStyle = "rgba(61,255,154,0.35)";
    ctx.fillRect(barX + barW * 0.38, h * 0.62, barW * 0.24, 28);
    ctx.fillStyle = "#ff6b4a";
    ctx.fillRect(barX, h * 0.62, barW * state.temp, 28);
    ctx.fillStyle = "#e8edf2";
    ctx.fillRect(barX + barW * state.temp - 2, h * 0.6, 4, 34);
  }

  function drawTrace(ctx, w, h, state) {
    var i;
    ctx.strokeStyle = "rgba(232,237,242,0.25)";
    ctx.lineWidth = 2;
    for (i = 0; i < state.edges.length; i++) {
      var a = state.nodes[state.edges[i][0]];
      var b = state.nodes[state.edges[i][1]];
      ctx.beginPath();
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
      ctx.stroke();
    }
    ctx.strokeStyle = "#3dff9a";
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (i = 0; i < state.path.length; i++) {
      var n = state.nodes[state.path[i]];
      if (i === 0) ctx.moveTo(n.x * w, n.y * h);
      else ctx.lineTo(n.x * w, n.y * h);
    }
    ctx.stroke();
    for (i = 0; i < state.nodes.length; i++) {
      var p = state.nodes[i];
      ctx.fillStyle = state.path.indexOf(i) !== -1 ? "#3dff9a" : "#e8edf2";
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 12, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawChoir(ctx, w, h, state) {
    var pads = [
      { x: 0.22, y: 0.55 },
      { x: 0.4, y: 0.38 },
      { x: 0.6, y: 0.38 },
      { x: 0.78, y: 0.55 },
    ];
    var lit = state.phase === "watch" ? state.sequence[Math.min(state.watchIndex, state.sequence.length - 1)] : -1;
    for (var i = 0; i < pads.length; i++) {
      ctx.fillStyle = i === lit ? "#3dff9a" : "rgba(8,10,14,0.65)";
      ctx.beginPath();
      ctx.arc(pads[i].x * w, pads[i].y * h, 48, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#e8edf2";
      ctx.stroke();
    }
  }

  function drawOre(ctx, w, h, state) {
    var spr = assets.sprites.asteroid;
    for (var i = 0; i < state.rocks.length; i++) {
      var r = state.rocks[i];
      var rw = r.r * w * 2;
      if (spr && spr.complete) ctx.drawImage(spr, r.x * w - rw / 2, r.y * h - rw / 2, rw, rw);
      else {
        ctx.fillStyle = "#c47a4a";
        ctx.beginPath();
        ctx.arc(r.x * w, r.y * h, r.r * w, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = "#3dff9a";
    ctx.beginPath();
    ctx.arc(state.aimX * w, state.aimY * h, 16, 0, Math.PI * 2);
    ctx.moveTo(state.aimX * w - 22, state.aimY * h);
    ctx.lineTo(state.aimX * w + 22, state.aimY * h);
    ctx.moveTo(state.aimX * w, state.aimY * h - 22);
    ctx.lineTo(state.aimX * w, state.aimY * h + 22);
    ctx.stroke();
  }

  function hitTest(bind, state, nx, ny, canvas) {
    if (state.gameId === "pipebloom") {
      var size = logicalSize(canvas);
      var layout = pipeLayout(state, size.w, size.h);
      var x = Math.floor((nx * size.w - layout.ox) / layout.cell);
      var y = Math.floor((ny * size.h - layout.oy) / layout.cell);
      if (x >= 0 && y >= 0 && x < state.cols && y < state.rows) return { type: "rotate", index: y * state.cols + x };
    }
    if (state.gameId === "tracelock") {
      for (var i = 0; i < state.nodes.length; i++) {
        if (Math.hypot(state.nodes[i].x - nx, state.nodes[i].y - ny) < 0.045) return { type: "pick", node: i };
      }
    }
    if (state.gameId === "ringchoir") {
      var pads = [
        { x: 0.22, y: 0.55 },
        { x: 0.4, y: 0.38 },
        { x: 0.6, y: 0.38 },
        { x: 0.78, y: 0.55 },
      ];
      for (var p = 0; p < pads.length; p++) {
        if (Math.hypot(pads[p].x - nx, pads[p].y - ny) < 0.08) return { type: "pad", pad: p };
      }
    }
    if (state.gameId === "orefall") return { type: "fire" };
    if (state.gameId === "drift") return { type: "steer", x: nx };
    if (state.gameId === "slingshot") return { type: "launch" };
    if (state.gameId === "phaseskip") return { type: "tap" };
    if (state.gameId === "heatband") return { type: "hold" };
    return null;
  }

  window.StarshipGameView = {
    prepare: prepare,
    draw: draw,
    hitTest: hitTest,
    resultCopy: resultCopy,
    syncCanvas: syncCanvas,
    assets: assets,
  };
})();
