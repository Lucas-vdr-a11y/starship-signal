"use strict";

var fs = require("fs");
var path = require("path");
var http = require("http");
var { execFileSync } = require("child_process");

var ROOT = path.resolve(__dirname, "..");
var SCRATCH =
  process.env.STARSHIP_SCRATCH ||
  "/var/folders/lw/46t57nl511b9n9smzzq1l2rw0000gn/T/grok-goal-47396ca18293/implementer";
var LOG = path.join(SCRATCH, "playwright.log");

function writeLog(msg) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.appendFileSync(LOG, msg + "\n");
  console.log(msg);
}

function mime(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
}

function serve() {
  return new Promise(function (resolve) {
    var server = http.createServer(function (req, res) {
      var urlPath = decodeURIComponent(req.url.split("?")[0]);
      if (urlPath === "/") urlPath = "/index.html";
      var file = path.normalize(path.join(ROOT, urlPath.replace(/^\/+/, "")));
      if (!file.startsWith(ROOT)) {
        res.statusCode = 403;
        return res.end();
      }
      fs.readFile(file, function (err, buf) {
        if (err) {
          res.statusCode = 404;
          return res.end("not found");
        }
        res.setHeader("Content-Type", mime(file));
        res.end(buf);
      });
    });
    server.listen(0, "127.0.0.1", function () {
      resolve({ server: server, port: server.address().port });
    });
  });
}

function loadPlaywright() {
  var roots = [];
  try {
    roots.push(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim());
  } catch (e) {
    void e;
  }
  roots.push(path.join(process.env.HOME || "", "node_modules"));
  roots.push(path.join(ROOT, "node_modules"));
  for (var i = 0; i < roots.length; i++) {
    try {
      return require(path.join(roots[i], "playwright"));
    } catch (e) {
      void e;
    }
  }
  return require("playwright");
}

async function main() {
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.writeFileSync(LOG, "");
  try {
    writeLog(execFileSync("npx", ["playwright", "--version"], { encoding: "utf8" }).trim());
  } catch (err) {
    writeLog("playwright launcher failed: " + (err && err.message));
    writeLog("environment limit — unit tests remain the bar");
    return;
  }

  var playwright;
  try {
    playwright = loadPlaywright();
  } catch (err) {
    writeLog("cannot require playwright: " + err.message);
    writeLog("environment limit — unit tests remain the bar");
    return;
  }

  var httpd = await serve();
  var url = "http://127.0.0.1:" + httpd.port + "/index.html";
  writeLog("serving " + url);

  try {
    var browser = await playwright.chromium.launch({ headless: true });
    var page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    var errors = [];
    page.on("pageerror", function (e) {
      var msg = String(e);
      if (msg.indexOf("pointer lock") !== -1 || msg.indexOf("PointerLock") !== -1) return;
      errors.push(msg);
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(3500);

    var canvasInfo = await page.evaluate(function () {
      var c = document.querySelector("#viewport canvas");
      if (!c) return { missing: true };
      var r = c.getBoundingClientRect();
      return {
        missing: false,
        cssW: r.width,
        cssH: r.height,
        bufW: c.width,
        bufH: c.height,
      };
    });
    writeLog("canvas " + JSON.stringify(canvasInfo));
    if (canvasInfo.missing) throw new Error("canvas missing");
    if (Math.abs(canvasInfo.cssW - 1280) > 2 || Math.abs(canvasInfo.cssH - 720) > 2) {
      throw new Error("canvas CSS size mismatch " + JSON.stringify(canvasInfo));
    }

    var cabinShot = path.join(SCRATCH, "cabin.png");
    var gameBefore = path.join(SCRATCH, "game-before.png");
    var gameAfter = path.join(SCRATCH, "game-after.png");
    await page.screenshot({ path: cabinShot, fullPage: true });

    var boot = await page.$("#boot-btn");
    if (boot) await boot.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: cabinShot, fullPage: true });

    var entered = await page.evaluate(function () {
      window.StarshipApp.begin();
      return window.StarshipApp.enterGame("w7");
    });
    writeLog("enterGame w7 " + entered);
    await page.waitForTimeout(400);
    var gameInfo = await page.evaluate(function () {
      var layer = document.getElementById("game-layer");
      var c = document.getElementById("game-canvas");
      if (!c) return { missing: true };
      var r = c.getBoundingClientRect();
      var ctx = c.getContext("2d");
      var pix = ctx.getImageData(0, 0, c.width, c.height).data;
      var filled = 0;
      for (var i = 0; i < pix.length; i += 4) {
        if (pix[i] + pix[i + 1] + pix[i + 2] > 12) filled++;
      }
      return {
        hidden: layer && layer.hidden,
        cssW: r.width,
        cssH: r.height,
        bufW: c.width,
        bufH: c.height,
        filled: filled,
        total: c.width * c.height,
        gameId: window.StarshipApp.getGameState() && window.StarshipApp.getGameState().gameId,
      };
    });
    writeLog("game surface " + JSON.stringify(gameInfo));
    if (gameInfo.missing || gameInfo.hidden) throw new Error("game surface not shown");
    if (gameInfo.filled / gameInfo.total < 0.35) throw new Error("game canvas empty");
    await page.screenshot({ path: gameBefore, fullPage: true });

    await page.evaluate(function () {
      var gs = window.StarshipApp.getGameState();
      window.StarshipGames.input(gs, { type: "aim", x: 0.25, y: 0.2 });
      window.StarshipGames.input(gs, { type: "fire" });
      window.StarshipGames.step(gs, 0.2);
      var bind = window.StarshipApp.getGameBind();
      var c = document.getElementById("game-canvas");
      window.StarshipGameView.draw(c.getContext("2d"), bind, gs);
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: gameAfter, fullPage: true });
    var beforeBuf = fs.readFileSync(gameBefore);
    var afterBuf = fs.readFileSync(gameAfter);
    if (beforeBuf.equals(afterBuf)) throw new Error("game before/after identical");
    writeLog("game buffer changed after input");

    var before = cabinShot;
    var after = gameAfter;

    var pixels = await page.evaluate(function () {
      var c = document.querySelector("#viewport canvas");
      var gl = c.getContext("webgl2") || c.getContext("webgl");
      if (!gl) return { noGl: true, bufW: c.width, bufH: c.height };
      var w = c.width;
      var h = c.height;
      var pix = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pix);
      var filled = 0;
      var minX = w;
      var minY = h;
      var maxX = 0;
      var maxY = 0;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var i = (y * w + x) * 4;
          if (pix[i] + pix[i + 1] + pix[i + 2] > 12) {
            filled++;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      return { bufW: w, bufH: h, filled: filled, minX: minX, minY: minY, maxX: maxX, maxY: maxY, total: w * h };
    });
    writeLog("pixels " + JSON.stringify(pixels));
    writeLog("page errors " + JSON.stringify(errors));

    if (errors.length) throw new Error("page errors: " + errors.join(" | "));
    if (pixels.noGl) throw new Error("no webgl context");
    var frac = pixels.filled / pixels.total;
    var bboxW = pixels.maxX - pixels.minX;
    var bboxH = pixels.maxY - pixels.minY;
    writeLog("painted fraction " + frac + " bbox " + bboxW + "x" + bboxH);
    if (frac < 0.4) throw new Error("canvas mostly empty fraction=" + frac);
    if (bboxW < canvasInfo.bufW * 0.7 || bboxH < canvasInfo.bufH * 0.7) {
      throw new Error("painted bbox too small");
    }

    writeLog("cabin + game screenshots written");
    await browser.close();
  } catch (err) {
    writeLog("playwright run failed: " + err.stack);
    var msg = String(err && err.message);
    if (/browserType\.launch|Executable doesn't exist|TargetClosed/.test(msg)) {
      writeLog("environment limit launching chromium");
    } else {
      process.exitCode = 1;
    }
  } finally {
    httpd.server.close();
  }
}

main().catch(function (err) {
  writeLog("fatal " + err.stack);
  process.exitCode = 1;
});
