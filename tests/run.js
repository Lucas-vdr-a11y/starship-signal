"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var assert = require("assert");
var { execFileSync } = require("child_process");

var ROOT = path.resolve(__dirname, "..");
var passed = 0;

function ok(cond, msg) {
  assert.ok(cond, msg);
  passed += 1;
  console.log("ok  " + msg);
}

function loadShipped() {
  var sandbox = {
    window: {},
    console: console,
  };
  sandbox.window = sandbox.window;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  ["js/sim.js", "js/games.js"].forEach(function (rel) {
    var src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.ok(!/\brequire\s*\(/.test(src), rel + " must not call require");
    assert.ok(!/\bmodule\.exports\b/.test(src), rel + " must not use module.exports");
    vm.runInContext(src, sandbox, { filename: rel });
  });
  ok(sandbox.window.StarshipSim, "StarshipSim installed on window");
  ok(sandbox.window.StarshipGames, "StarshipGames installed on window");
  return sandbox.window;
}

function jpegLongEdge(filePath) {
  var buf = fs.readFileSync(filePath);
  var i = 2;
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) break;
    var marker = buf[i + 1];
    var len = buf.readUInt16BE(i + 2);
    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3
    ) {
      var h = buf.readUInt16BE(i + 5);
      var w = buf.readUInt16BE(i + 7);
      return Math.max(w, h);
    }
    i += 2 + len;
  }
  throw new Error("no SOF in " + filePath);
}

function main() {
  var shipped = loadShipped();
  var Sim = shipped.StarshipSim;
  var Games = shipped.StarshipGames;
  var state = Sim.createState();
  ok(state.y === Sim.CONFIG.eyeHeight, "spawn eye height is configured");
  ok(Math.hypot(state.x, state.z) < Sim.CONFIG.hullRadius, "spawn inside hull");

  var yaw0 = state.yaw;
  Sim.look(state, 400, 0);
  ok(state.yaw !== yaw0, "look dx changes yaw from live state");

  var pitched = Sim.createState();
  Sim.look(pitched, 0, -1e6);
  ok(pitched.pitch === Sim.CONFIG.pitchMax, "look clamps pitch to max");
  Sim.look(pitched, 0, 1e6);
  ok(pitched.pitch === Sim.CONFIG.pitchMin, "look clamps pitch to min");

  var walker = Sim.createState();
  walker.yaw = 0;
  walker.x = 0;
  walker.z = 0;
  var beforeZ = walker.z;
  Sim.move(walker, { forward: true }, 0.25);
  ok(walker.z < beforeZ, "forward at yaw 0 walks toward -Z");
  var lv = Sim.lookVector(walker);
  ok(lv.z < 0, "look vector at yaw 0 faces -Z");

  var right = Sim.createState();
  right.yaw = 0;
  right.x = 0;
  right.z = 0;
  Sim.move(right, { right: true }, 0.25);
  ok(right.x > 0, "strafe right at yaw 0 increases +X");

  var outsider = Sim.createState();
  outsider.x = 40;
  outsider.z = 0;
  Sim.collideHull(outsider, []);
  var r = Math.hypot(outsider.x, outsider.z);
  var maxR = Sim.CONFIG.hullRadius - Sim.CONFIG.innerClearance;
  ok(r <= maxR + 1e-9, "hull collision keeps player inside inner radius");

  var intoHatch = Sim.createState();
  intoHatch.x = 0.05;
  intoHatch.z = 0.05;
  var obs = Sim.cabinObstacles();
  Sim.collideHull(intoHatch, obs);
  var hd = Math.hypot(intoHatch.x, intoHatch.z);
  ok(hd >= 0.62 + Sim.CONFIG.playerRadius - 1e-6, "hatch cylinder blocks the origin");

  var ledger = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/ledger.json"), "utf8"));
  var bound = Sim.bindWindows(ledger);
  ok(bound.length === 8, "ledger binds eight window surfaces");
  bound.forEach(function (w) {
    var abs = path.join(ROOT, w.still);
    ok(fs.existsSync(abs), "still exists for " + w.id);
    var edge = jpegLongEdge(abs);
    ok(edge >= 1280, w.id + " long edge is " + edge + " (>=1280)");
    var media = Sim.resolveWindowMedia(ledger, w.id);
    ok(media.still === w.still, "resolveWindowMedia still path for " + w.id);
  });

  var videoWin = Sim.primaryVideoWindow(ledger);
  ok(videoWin && videoWin.video, "at least one window binds a video");
  var vAbs = path.join(ROOT, videoWin.video);
  ok(fs.existsSync(vAbs), "video file exists on disk");
  ok(fs.statSync(vAbs).size > 100000, "video is not a tiny placeholder");

  var probe = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      vAbs,
    ],
    { encoding: "utf8" }
  ).trim();
  var dur = parseFloat(probe);
  ok(dur >= 5.5 && dur <= 10.5, "video duration is 6s or 10s (got " + dur + ")");

  ok(videoWin.video.indexOf("w4-helios.mp4") !== -1, "Helios window binds the Imagine clip");

  var worlds = {};
  var gameIds = {};
  bound.forEach(function (w) {
    ok(w.gameId, w.id + " has a gameId");
    ok(w.world, w.id + " has a world name");
    ok(!worlds[w.world], "world name unique: " + w.world);
    ok(!gameIds[w.gameId], "gameId unique: " + w.gameId);
    worlds[w.world] = true;
    gameIds[w.gameId] = true;
    var act = Games.activateWindow(ledger, w.id);
    ok(act && act.gameId === w.gameId, "activateWindow routes " + w.id + " to " + w.gameId);
    ok(act.still === w.still, "activate still path is ledger still for " + w.id);
  });

  var tools = bound.map(function (w) {
    return w.tool;
  }).join(" ");
  ok(/image_gen|image_edit|image_to_video/.test(tools), "ledger names Imagine tools");

  var missing = Sim.resolveWindowMedia(ledger, "nope");
  ok(missing === null, "unknown window id returns null");

  var gs;
  gs = Games.start("pipebloom");
  var rot0 = gs.grid[1].rot;
  Games.input(gs, { type: "rotate", index: 1 });
  ok(gs.grid[1].rot !== rot0, "pipebloom rotate changes tile rotation");
  ok(gs.fx && gs.fx.indexOf("rotate") !== -1, "pipebloom rotate emits a sound cue");
  var taken = Games.takeFx(gs);
  ok(taken.indexOf("rotate") !== -1 && gs.fx.length === 0, "takeFx drains rotate cue");
  Games.step(gs, 0.016);
  ok(typeof gs.watered === "number", "pipebloom step computes watered count");

  function armDirs(cell) {
    return Games.pipeStrokeArms(cell)
      .map(function (a) {
        return a.dir;
      })
      .sort()
      .join(",");
  }
  function sameSet(a, b) {
    return a.slice().sort().join(",") === b.slice().sort().join(",");
  }
  ok(armDirs({ shape: "L", rot: 0 }) === "e,n", "L rot0 draws n+e only");
  ok(armDirs({ shape: "T", rot: 0 }) === "e,n,w", "T rot0 draws w+n+e, not south");
  ok(armDirs({ shape: "I", rot: 0 }) === "n,s", "I rot0 draws n+s only");
  ok(armDirs({ shape: "I", rot: 1 }) === "e,w", "I rot1 draws e+w only");
  var liveL = null;
  var liveT = null;
  var liveI = null;
  gs.grid.forEach(function (c) {
    if (!liveL && c.shape === "L") liveL = c;
    if (!liveT && c.shape === "T") liveT = c;
    if (!liveI && c.shape === "I") liveI = c;
  });
  ok(sameSet(Games.pipeStrokeArms(liveL).map(function (a) { return a.dir; }), Games.dirsFromShape(liveL.shape, liveL.rot)), "start() L tile stroke arms === dirsFromShape");
  ok(Games.pipeStrokeArms(liveL).length === 2, "start() L tile draws two arms");
  ok(Games.pipeStrokeArms(liveT).length === 3, "start() T tile draws three arms");
  ok(Games.pipeStrokeArms(liveI).length === 2, "start() I tile draws two arms");
  var beforeArms = armDirs(liveL);
  Games.input(gs, { type: "rotate", index: gs.grid.indexOf(liveL) });
  ok(armDirs(liveL) !== beforeArms, "rotate changes which arms a live L tile draws");
  var viewSrc = fs.readFileSync(path.join(ROOT, "js/game-view.js"), "utf8");
  ok(viewSrc.indexOf("pipeStrokeArms") !== -1, "drawPipes uses shipped pipeStrokeArms");
  ok(viewSrc.indexOf("moveTo(0, -cell * 0.28)") === -1, "drawPipes no longer hardcodes a full N-S stem");

  gs = Games.start("slingshot");
  Games.input(gs, { type: "aim", angle: -0.4 });
  Games.input(gs, { type: "power", power: 0.8 });
  ok(gs.launched === false, "slingshot not launched until launch");
  var px0 = gs.px;
  Games.input(gs, { type: "launch" });
  Games.step(gs, 0.03);
  ok(gs.launched === true && gs.px !== px0, "slingshot launch + step moves the probe");

  gs = Games.start("drift");
  var x0 = gs.x;
  Games.input(gs, { type: "nudge", dx: -0.2 });
  ok(gs.x < x0, "drift nudge moves probe");
  gs.motes = [{ x: gs.x, y: gs.y, r: 0.03 }];
  var score0 = gs.score;
  Games.step(gs, 0.016);
  ok(gs.score > score0, "drift step collects an overlapping mote");

  gs = Games.start("phaseskip");
  gs.pulses = [{ t: 0.8 }];
  var hits0 = gs.hits;
  Games.input(gs, { type: "tap" });
  ok(gs.hits > hits0, "phaseskip tap in window scores a hit");

  gs = Games.start("heatband");
  var sh0 = gs.shield;
  Games.input(gs, { type: "hold" });
  Games.step(gs, 0.05);
  ok(gs.shield > sh0, "heatband hold + step raises the veil");

  gs = Games.start("tracelock");
  var plen = gs.path.length;
  Games.input(gs, { type: "pick", node: 1 });
  ok(gs.path.length === plen + 1, "tracelock pick appends a connected node");

  gs = Games.start("ringchoir");
  gs.phase = "play";
  var lv0 = gs.level;
  Games.input(gs, { type: "pad", pad: gs.sequence[0] });
  ok(gs.level > lv0 || gs.inputSeq.length > 0, "ringchoir pad input advances the round");

  gs = Games.start("orefall");
  var sc0 = gs.score;
  Games.input(gs, { type: "aim", x: gs.rocks[0].x, y: gs.rocks[0].y });
  Games.input(gs, { type: "fire" });
  ok(gs.score > sc0, "orefall fire on a rock increases score");
  var nRocks = gs.rocks.length;
  Games.step(gs, 0.04);
  ok(gs.rocks.length <= nRocks, "orefall step advances rocks");

  var lookAtW1 = Sim.createState();
  lookAtW1.yaw = 0;
  lookAtW1.pitch = 0;
  var picked = Sim.pickWindow(lookAtW1, ledger);
  ok(picked && picked.id === "w1", "spawn look picks the forward Charybdis pane");

  console.log("\n" + passed + " assertions passed");
}

main();
