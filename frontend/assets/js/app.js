/* ============================================================================
 * Kolamaya Kolam — browser app (UI, animation, export)
 * Depends on the global `KolamCore` from core.js
 * ==========================================================================*/
(function () {
  "use strict";
  var K = window.KolamCore;

  /* ---------------- constants / colours ---------------- */
  var COLORS = {
    headerGreen: "#286f66",
    amber100: "#fffaf0",
    amber700: "#b94f35",
    amber800: "#913a28",
    amber900: "#481d24",
    gold: "#f4c75a",
    cardBg: "#481d24",
    embedBg: "#481d24",
    brush: "#ffffff"
  };

  /* ---------------- helpers ---------------- */
  function $(sel) { return document.querySelector(sel); }
  function durationForSpeed(s) { return Math.round(7500 + 7500 * (1 - (s - 1) / 9)); }
  function speedForDuration(d) { return Math.round(1 + 9 * (1 - (d - 7500) / 7500)); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function pathD(cp) {
    if (!cp || cp.length === 0) return "";
    var d = "M " + cp[0].x + " " + cp[0].y;
    for (var i = 1; i < cp.length; i++) {
      var e = cp[i], n = cp[i - 1];
      if (e.controlX !== undefined && e.controlY !== undefined) {
        d += " Q " + e.controlX + " " + e.controlY + " " + e.x + " " + e.y;
      } else {
        var mx = (n.x + e.x) / 2, my = (n.y + e.y) / 2;
        d += " Q " + mx + " " + my + " " + e.x + " " + e.y;
      }
    }
    return d;
  }
  function curveLength(cp) {
    if (!cp || cp.length < 2) return 100;
    var len = 0;
    for (var i = 1; i < cp.length; i++) {
      var dx = cp[i].x - cp[i - 1].x, dy = cp[i].y - cp[i - 1].y;
      len += Math.sqrt(dx * dx + dy * dy);
    }
    return Math.max(len, 50);
  }

  /* ---------------- state ---------------- */
  var params = readParams();
  var size = params.size;
  var speed = params.speed;
  var duration = params.duration;
  var autoAnimate = params.initialAutoAnimate;
  var pattern = null;
  var animState = "stopped"; // "stopped" | "playing"
  var exporting = false;
  var menuOpen = false;
  var playTimer = null;
  var autoPlayTimer = null;
  var backendAvailable = false;
  var backendInfo = null;

  function setBackendStatus(online, info) {
    backendAvailable = online;
    backendInfo = info || null;
    var badge = document.getElementById("ai-status");
    if (!badge) return;
    badge.classList.toggle("online", online);
    badge.classList.toggle("offline", !online);
    var label = badge.querySelector("span");
    if (label) label.textContent = online ? "Vision API · Hybrid AI" : "Local vision mode";
    badge.title = online
      ? "Flask backend connected. Runtime: KOLAMAYA Hybrid Vision Engine v1."
      : "Backend unavailable; browser-side vision remains active.";

    var unetOption = document.querySelector('#complete-engine option[value="unet"]');
    var note = document.getElementById("engine-note");
    if (unetOption) {
      var ready = !!(info && info.unetReady);
      unetOption.disabled = !ready;
      unetOption.textContent = ready
        ? "U-Net neural model — checkpoint loaded"
        : "U-Net neural model — checkpoint required";
      if (note) note.textContent = online
        ? (ready
          ? "The Flask API is connected and both engines are available."
          : "Hybrid Vision is active. Train the included U-Net to unlock neural completion.")
        : "Start the Flask server to use backend inference; local hybrid vision still works.";
    }
  }

  function checkBackend() {
    if (!window.fetch || window.location.protocol === "file:") {
      setBackendStatus(false);
      return;
    }
    fetch("/api/health", { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("API unavailable");
        return response.json();
      })
      .then(function (info) { setBackendStatus(true, info); })
      .catch(function () { setBackendStatus(false); });
  }

  function readParams() {
    var q = new URLSearchParams(window.location.search);
    var size = clamp(parseInt(q.get("size") || "7", 10), 3, 15);
    if (isNaN(size)) size = 7;
    var duration = clamp(parseInt(q.get("duration") || "10000", 10), 1000, 30000);
    if (isNaN(duration)) duration = 10000;
    return {
      size: size,
      speed: clamp(speedForDuration(duration), 1, 10),
      duration: duration,
      initialAutoAnimate: q.get("initial-auto-animate") === "true"
    };
  }

  /* ---------------- URL sync ---------------- */
  function syncURL() {
    var u = new URL(window.location.href);
    u.searchParams.set("size", String(size));
    u.searchParams.set("duration", String(duration));
    u.searchParams.set("initial-auto-animate", String(autoAnimate));
    window.history.replaceState({}, "", u.toString());
  }

  /* ---------------- generation ---------------- */
  function generate() {
    try {
      if (autoPlayTimer) { clearTimeout(autoPlayTimer); autoPlayTimer = null; }
      pattern = K.generateKolam1D(size);
      setAnimState("stopped");
      if (autoAnimate) {
        autoPlayTimer = setTimeout(function () {
          autoPlayTimer = null;
          if (pattern) setAnimState("playing");
        }, 100);
      }
    } catch (err) {
      console.error("Error generating pattern:", err);
      toast("Error generating pattern: " + (err && err.message ? err.message : err));
    }
  }

  function setAnimState(s) {
    animState = s;
    if (playTimer) { clearTimeout(playTimer); playTimer = null; }
    if (animState === "playing" && pattern) {
      playTimer = setTimeout(function () { setAnimState("stopped"); }, duration);
    }
    render();
  }

  /* ---------------- rendering ---------------- */
  function render() {
    var host = $("#kolam-svg-host");
    var playBtn = $("#play-btn");
    if (!pattern) { host.innerHTML = ""; return; }

    var dims = pattern.dimensions, dots = pattern.dots, curves = pattern.curves;
    var playing = animState === "playing";
    var out = '<svg width="' + dims.width + '" height="' + dims.height +
      '" viewBox="0 0 ' + dims.width + ' ' + dims.height +
      '" class="kolam-svg" style="max-width:100%;height:auto">';

    dots.forEach(function (d, i) {
      var r = d.radius || 3;
      var fill = d.filled ? (d.color || "white") : "none";
      var sw = d.filled ? 0 : 1;
      var style;
      if (playing) {
        style = "animation-delay:" + ((i / dots.length) * duration * 0.9) + "ms;" +
          "animation-duration:" + (duration / dots.length) + "ms;opacity:0";
      } else {
        style = "opacity:1";
      }
      out += '<circle cx="' + d.center.x + '" cy="' + d.center.y + '" r="' + r +
        '" fill="' + fill + '" stroke="' + (d.color || "white") + '" stroke-width="' + sw +
        '" class="' + (playing ? "kolam-dot-animated" : "kolam-dot") + '" style="' + style + '"></circle>';
    });

    curves.forEach(function (c, i) {
      var len = curveLength(c.curvePoints);
      var dur = (duration / curves.length) * 3;
      var delay = (dur * i) / 3;
      var stroke = c.color || "white";
      var sw = c.strokeWidth || 2;
      var cls, style;
      if (playing) {
        cls = c.curvePoints && c.curvePoints.length > 1 ? "kolam-path-animated" : "kolam-line-animated";
        style = "animation-delay:" + delay + "ms;animation-duration:" + dur + "ms;" +
          "stroke-dasharray:" + len + ";stroke-dashoffset:" + len;
      } else {
        cls = c.curvePoints && c.curvePoints.length > 1 ? "kolam-path" : "kolam-line";
        style = "stroke-dasharray:none;stroke-dashoffset:0;opacity:1";
      }
      if (c.curvePoints && c.curvePoints.length > 1) {
        out += '<path d="' + pathD(c.curvePoints) + '" stroke="' + stroke + '" stroke-width="' + sw +
          '" fill="none" stroke-linecap="round" stroke-linejoin="round" class="' + cls + '" style="' + style + '"></path>';
      } else {
        out += '<line x1="' + c.start.x + '" y1="' + c.start.y + '" x2="' + c.end.x + '" y2="' + c.end.y +
          '" stroke="' + stroke + '" stroke-width="' + sw + '" stroke-linecap="round" class="' + cls + '" style="' + style + '"></line>';
      }
    });

    out += "</svg>";
    host.innerHTML = out;
    syncControls();
  }

  function syncControls() {
    $("#size-value").textContent = size;
    $("#speed-value").textContent = speed;
    $("#size-hint").textContent = "Creates a " + size + "x" + size + " pattern grid";
    $("#duration-hint").textContent = "Total: " + (duration / 1000).toFixed(1) + "s";
    $("#size-range").value = size;
    $("#speed-range").value = speed;
    var playing = animState === "playing";
    $("#play-btn").innerHTML = (playing ? "■" : "▶") + " " +
      (playing ? "Stop Animation" : "Play Animation");
    $("#play-btn").setAttribute("title", playing ? "Stop Animation (P)" : "Play Animation (P)");
    $("#play-btn").style.backgroundColor = playing ? COLORS.gold : "";
    $("#play-btn").style.color = playing ? COLORS.amber800 : "";
  }

  /* ---------------- toast ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2600);
  }

  /* ---------------- clipboard ---------------- */
  function copyText(text) {
    return new Promise(function (resolve) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { resolve(true); },
          function () { resolve(legacyCopy(text)); });
      } else {
        resolve(legacyCopy(text));
      }
    });
  }
  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  /* ---------------- export: SVG ---------------- */
  function buildSVGString(pat, bg) {
    var dims = pat.dimensions, dots = pat.dots, curves = pat.curves;
    var s = '<svg width="' + dims.width + '" height="' + dims.height +
      '" viewBox="0 0 ' + dims.width + " " + dims.height +
      '" xmlns="http://www.w3.org/2000/svg">';
    if (bg) s += '<rect width="100%" height="100%" fill="' + bg + '"/>';
    dots.forEach(function (d) {
      s += '<circle cx="' + d.center.x + '" cy="' + d.center.y + '" r="' + (d.radius || 3) +
        '" fill="' + (d.filled ? (d.color || "white") : "none") + '" stroke="' + (d.color || "white") +
        '" stroke-width="' + (d.filled ? 0 : 1) + '" />';
    });
    curves.forEach(function (c) {
      if (c.curvePoints && c.curvePoints.length > 1) {
        s += '<path d="' + pathD(c.curvePoints) + '" stroke="' + (c.color || "white") +
          '" stroke-width="' + (c.strokeWidth || 2) + '" fill="none" stroke-linecap="round" stroke-linejoin="round" />';
      } else {
        s += '<line x1="' + c.start.x + '" y1="' + c.start.y + '" x2="' + c.end.x + '" y2="' + c.end.y +
          '" stroke="' + (c.color || "white") + '" stroke-width="' + (c.strokeWidth || 2) + '" stroke-linecap="round" />';
      }
    });
    s += "</svg>";
    return s;
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function downloadSVG() {
    var blob = new Blob([buildSVGString(pattern, COLORS.cardBg)], { type: "image/svg+xml" });
    downloadBlob(blob, pattern.name + ".svg");
  }

  /* ---------------- export: canvas rendering ---------------- */
  // Draws the pattern onto a canvas. `reveal` optionally reveals only the
  // first N dots / curves (used for the animated GIF).
  function renderToCanvas(pat, opts) {
    opts = opts || {};
    var scale = opts.scale || 2;
    var bg = opts.bg || COLORS.cardBg;
    var dotsN = opts.dotsN !== undefined ? opts.dotsN : pat.dots.length;
    var curvesN = opts.curvesN !== undefined ? opts.curvesN : pat.curves.length;
    var w = Math.round(pat.dimensions.width * scale);
    var h = Math.round(pat.dimensions.height * scale);
    var canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.scale(scale, scale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (var i = 0; i < dotsN; i++) {
      var d = pat.dots[i];
      ctx.beginPath();
      ctx.arc(d.center.x, d.center.y, d.radius || 3, 0, Math.PI * 2);
      ctx.fillStyle = d.color || "white";
      ctx.fill();
    }
    for (var j = 0; j < curvesN; j++) {
      var c = pat.curves[j];
      ctx.strokeStyle = c.color || "white";
      ctx.lineWidth = c.strokeWidth || 1.5;
      var cp = c.curvePoints;
      if (cp && cp.length > 1) {
        ctx.beginPath();
        ctx.moveTo(cp[0].x, cp[0].y);
        for (var k = 1; k < cp.length; k++) {
          var prev = cp[k - 1], cur = cp[k];
          ctx.quadraticCurveTo((prev.x + cur.x) / 2, (prev.y + cur.y) / 2, cur.x, cur.y);
        }
        ctx.stroke();
      } else if (c.start && c.end) {
        ctx.beginPath();
        ctx.moveTo(c.start.x, c.start.y);
        ctx.lineTo(c.end.x, c.end.y);
        ctx.stroke();
      }
    }
    return canvas;
  }

  function downloadPNG() {
    var canvas = renderToCanvas(pattern, { scale: 2, bg: COLORS.cardBg });
    canvas.toBlob(function (blob) {
      if (blob) downloadBlob(blob, pattern.name + ".png");
      else toast("PNG export failed. Please try again.");
    }, "image/png");
  }

  /* ---------------- export: animated GIF ---------------- */
  function downloadGIF() {
    var frameCount = 30;
    var scale = 1;
    var w = Math.round(pattern.dimensions.width * scale);
    var h = Math.round(pattern.dimensions.height * scale);
    var frames = [];
    var delayMs = Math.max(40, Math.round(duration / frameCount));

    for (var s = 0; s <= frameCount; s++) {
      var frac = s / frameCount;
      var canvas = renderToCanvas(pattern, {
        scale: scale,
        bg: COLORS.cardBg,
        dotsN: Math.floor(pattern.dots.length * frac),
        curvesN: Math.floor(pattern.curves.length * frac)
      });
      frames.push(canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data);
    }

    setTimeout(function () {
      try {
        var gif = encodeGIF(frames, w, h, delayMs);
        downloadBlob(new Blob([gif], { type: "image/gif" }), pattern.name + ".gif");
      } catch (err) {
        console.error("GIF export failed:", err);
        toast("GIF export failed. Please try again.");
      }
      setExporting(false);
    }, 30);
  }

  /* ---------------- GIF encoder (LZW, palette on bg->white ramp) ---------------- */
  function encodeGIF(frames, width, height, delayMs) {
    // Build palette: interpolate from card background to white.
    var bg = hexToRgb(COLORS.cardBg);
    var palette = new Uint8Array(256 * 3);
    for (var i = 0; i < 256; i++) {
      var t = i / 255;
      palette[i * 3] = Math.round(bg[0] + (255 - bg[0]) * t);
      palette[i * 3 + 1] = Math.round(bg[1] + (255 - bg[1]) * t);
      palette[i * 3 + 2] = Math.round(bg[2] + (255 - bg[2]) * t);
    }

    // Quantize a pixel to the nearest palette index (pixels lie on the ramp).
    var dr = 255 - bg[0], dg = 255 - bg[1], db = 255 - bg[2];
    function pixelIndex(r, g, b) {
      var tr = (r - bg[0]) / dr, tg = (g - bg[1]) / dg, tb = (b - bg[2]) / db;
      var t = (tr + tg + tb) / 3;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      return Math.round(t * 255);
    }

    var bytes = [];
    function push16(v) { bytes.push(v & 0xff, (v >> 8) & 0xff); }
    function pushStr(s) { for (var x = 0; x < s.length; x++) bytes.push(s.charCodeAt(x) & 0xff); }

    // Header + logical screen descriptor
    pushStr("GIF89a");
    push16(width); push16(height);
    bytes.push(0xf7); // global colour table, 256 entries (2^(7+1))
    bytes.push(0);    // background colour index = 0 (the card bg)
    bytes.push(0);    // pixel aspect ratio
    for (var p = 0; p < palette.length; p++) bytes.push(palette[p]);

    // NETSCAPE loop extension
    bytes.push(0x21, 0xff, 0x0b);
    pushStr("NETSCAPE2.0");
    bytes.push(0x03, 0x01);
    push16(0); // loop forever
    bytes.push(0x00);

    var delayCs = Math.max(2, Math.round(delayMs / 10));
    var minCodeSize = 8;

    for (var f = 0; f < frames.length; f++) {
      // Graphic Control Extension
      bytes.push(0x21, 0xf9, 0x04, 0x00);
      push16(delayCs);
      bytes.push(0x00, 0x00);
      // Image descriptor
      bytes.push(0x2c);
      push16(0); push16(0); push16(width); push16(height);
      bytes.push(0x00); // no local colour table
      // LZW data
      bytes.push(minCodeSize);
      var imgBytes = [];
      var data = frames[f];
      var clearCode = 1 << minCodeSize;
      var endCode = clearCode + 1;
      var nextCode = endCode + 1;
      var codeSize = minCodeSize + 1;
      var dict = new Map();
      function writeCode(code) {
        bitBuf |= code << bitCnt;
        bitCnt += codeSize;
        while (bitCnt >= 8) {
          imgBytes.push(bitBuf & 0xff);
          bitBuf >>= 8;
          bitCnt -= 8;
        }
      }
      var bitBuf = 0, bitCnt = 0;
      writeCode(clearCode);
      var prev = pixelIndex(data[0], data[1], data[2]);
      for (var q = 4; q < data.length; q += 4) {
        var k = pixelIndex(data[q], data[q + 1], data[q + 2]);
        var key = (prev << 8) | k;
        if (dict.has(key)) {
          prev = dict.get(key);
        } else {
          writeCode(prev);
          if (nextCode < 4096) {
            dict.set(key, nextCode++);
            if (nextCode === (1 << codeSize) + 1 && codeSize < 12) codeSize++;
          } else {
            writeCode(clearCode);
            dict.clear();
            nextCode = endCode + 1;
            codeSize = minCodeSize + 1;
          }
          prev = k;
        }
      }
      writeCode(prev);
      writeCode(endCode);
      if (bitCnt > 0) imgBytes.push(bitBuf & 0xff);

      // Sub-blocks (max 255 bytes each)
      for (var bi = 0; bi < imgBytes.length; bi += 255) {
        var chunk = imgBytes.slice(bi, bi + 255);
        bytes.push(chunk.length);
        for (var ci = 0; ci < chunk.length; ci++) bytes.push(chunk[ci]);
      }
      bytes.push(0x00); // block terminator
    }

    bytes.push(0x3b); // trailer
    return new Uint8Array(bytes);
  }
  function hexToRgb(hex) {
    var h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  /* ---------------- embed code / raw SVG ---------------- */
  function copyEmbedCode() {
    try {
      var svg = buildSVGString(pattern, COLORS.embedBg);
      var uri = "data:image/svg+xml," + encodeURIComponent(svg);
      var html = '<img src="' + uri + '" alt="Kolam Pattern" style="max-width: 100%; height: auto;" />';
      copyText(html).then(function (ok) {
        toast(ok ? "Embed code copied to clipboard!" : "Could not copy to clipboard.");
      });
    } catch (err) {
      console.error("Failed to generate embed code:", err);
      toast("Failed to copy embed code. Please try again.");
    }
  }

  function copyRawSVG() {
    try {
      var svg = buildSVGString(pattern, COLORS.cardBg);
      copyText(svg).then(function (ok) {
        toast(ok ? "Raw SVG code copied to clipboard!" : "Could not copy to clipboard.");
      });
    } catch (err) {
      console.error("Failed to copy raw SVG:", err);
      toast("Failed to copy raw SVG. Please try again.");
    }
  }

  /* ---------------- export dispatcher ---------------- */
  function setExporting(v) {
    exporting = v;
    $("#dl-btn").disabled = v;
    $("#dl-btn").textContent = v ? "…" : "↓";
  }

  function handleExport(kind) {
    if (!pattern || exporting) return;
    closeMenu();
    if (kind === "svg") { downloadSVG(); return; }
    if (kind === "png") { downloadPNG(); return; }
    if (kind === "gif") {
      setExporting(true);
      downloadGIF();
      return;
    }
    if (kind === "embed") { copyEmbedCode(); return; }
    if (kind === "raw") { copyRawSVG(); return; }
  }

  /* ---------------- download menu ---------------- */
  function openMenu() { menuOpen = true; $("#dl-menu").classList.add("open"); }
  function closeMenu() { menuOpen = false; $("#dl-menu").classList.remove("open"); }
  function toggleMenu() {
    if (exporting) return;
    menuOpen ? closeMenu() : openMenu();
  }

  /* ---------------- wiring ---------------- */
  function bind() {
    $("#size-range").addEventListener("input", function (e) {
      size = clamp(parseInt(e.target.value, 10) || 7, 3, 15);
      syncURL();
      generate();
    });
    $("#speed-range").addEventListener("input", function (e) {
      speed = clamp(parseInt(e.target.value, 10) || 7, 1, 10);
      duration = durationForSpeed(speed);
      syncURL();
      syncControls();
    });
    $("#play-btn").addEventListener("click", function () {
      setAnimState(animState === "playing" ? "stopped" : "playing");
    });
    $("#generate-btn").addEventListener("click", generate);
    $("#dl-btn").addEventListener("click", toggleMenu);
    ["svg", "png", "gif", "embed", "raw"].forEach(function (kind) {
      $("#dl-" + kind).addEventListener("click", function () { handleExport(kind); });
    });

    document.addEventListener("mousedown", function (e) {
      if (menuOpen && !e.target.closest(".download-menu")) closeMenu();
    });

    window.addEventListener("keydown", function (e) {
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      switch (e.key.toLowerCase()) {
        case " ":
        case "p":
          e.preventDefault();
          setAnimState(animState === "playing" ? "stopped" : "playing");
          break;
        case "g":
          e.preventDefault();
          generate();
          break;
        case "escape":
          e.preventDefault();
          setAnimState("stopped");
          break;
      }
    });
  }

  /* ---------------- tabs ---------------- */
  function switchTab(name) {
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-tab") === name);
    });
    ["generator", "complete", "reconstruct", "recreate", "analyze"].forEach(function (n) {
      var p = document.getElementById("panel-" + n);
      p.classList.toggle("hidden", n !== name);
    });
  }

  /* ---------------- file loading ---------------- */
  function readFileToImage(file, cb) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast("Please choose an image file."); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () { cb(img); };
      img.onerror = function () { toast("Could not load that image."); };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function bindDropZone(dropId, fileId, onFile) {
    var drop = document.getElementById(dropId);
    var input = document.getElementById(fileId);
    drop.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () {
      if (input.files && input.files[0]) onFile(input.files[0]);
    });
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("dragging"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("dragging"); });
    });
    drop.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
    });
  }

  function imageToImageData(img) {
    var c = document.createElement("canvas");
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    var ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, c.width, c.height);
  }

  function drawImageFit(img, canvas, maxDim) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    var scale = maxDim ? Math.min(1, maxDim / Math.max(w, h)) : 1;
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  }

  function putImageDataToCanvas(buf, canvas, maxDim) {
    var scale = maxDim ? Math.min(1, maxDim / Math.max(buf.width, buf.height)) : 1;
    canvas.width = Math.max(1, Math.round(buf.width * scale));
    canvas.height = Math.max(1, Math.round(buf.height * scale));
    var ctx = canvas.getContext("2d");
    var off = document.createElement("canvas");
    off.width = buf.width; off.height = buf.height;
    off.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(buf.data), buf.width, buf.height), 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  /* ---------------- half completion ---------------- */
  var completeImage = null;
  var completeSourceFile = null;
  var completeOutput = null; // {width,height,data}

  function onCompleteFile(file) {
    completeSourceFile = file;
    readFileToImage(file, function (img) {
      completeImage = img;
      drawImageFit(img, document.getElementById("complete-in"), 360);
      document.getElementById("complete-run").disabled = false;
      document.getElementById("complete-tiles").disabled = false;
      document.getElementById("complete-status").textContent =
        "Image loaded (" + (img.naturalWidth || img.width) + "×" + (img.naturalHeight || img.height) + "). Pick an axis and complete it.";
      runComplete();
    });
  }

  function finishCompletionImage(img, message) {
    var data = imageToImageData(img);
    completeOutput = {
      width: data.width,
      height: data.height,
      data: new Uint8ClampedArray(data.data)
    };
    putImageDataToCanvas(completeOutput, document.getElementById("complete-out"), 360);
    document.getElementById("complete-download").disabled = false;
    document.getElementById("complete-status").textContent = message;
  }

  function runCompleteLocal() {
    try {
      var mode = document.getElementById("complete-axis").value;
      var imgData = imageToImageData(completeImage);
      var res = KolamVision.completeHalf(imgData, mode);
      completeOutput = res;
      putImageDataToCanvas(res, document.getElementById("complete-out"), 360);
      document.getElementById("complete-download").disabled = false;
      var modeLabel = document.getElementById("complete-axis").selectedOptions[0].textContent;
      document.getElementById("complete-status").textContent =
        "Completed locally (" + res.width + "×" + res.height + "px, axis: " + modeLabel + ").";
    } catch (err) {
      console.error(err);
      toast("Completion failed: " + (err && err.message ? err.message : err));
    }
  }

  function runComplete() {
    if (!completeImage) return;
    if (!backendAvailable || !completeSourceFile) {
      runCompleteLocal();
      return;
    }

    var mode = document.getElementById("complete-axis").value;
    var engineSelect = document.getElementById("complete-engine");
    var engine = engineSelect ? engineSelect.value : "hybrid";
    var status = document.getElementById("complete-status");
    status.textContent = "Running " + (engine === "unet" ? "U-Net" : "Hybrid Vision") + " completion on the Flask API…";
    document.getElementById("complete-run").disabled = true;

    var form = new FormData();
    form.append("image", completeSourceFile, completeSourceFile.name || "kolam.png");
    form.append("mode", mode);
    form.append("engine", engine);

    fetch("/api/complete", { method: "POST", body: form })
      .then(function (response) {
        if (!response.ok) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            throw new Error(body.error || "Backend completion failed.");
          });
        }
        var usedEngine = response.headers.get("X-Kolamaya-Engine") || engine;
        var resolvedMode = response.headers.get("X-Kolamaya-Mode") || mode;
        return response.blob().then(function (blob) {
          return { blob: blob, usedEngine: usedEngine, resolvedMode: resolvedMode };
        });
      })
      .then(function (result) {
        var url = URL.createObjectURL(result.blob);
        var img = new Image();
        img.onload = function () {
          finishCompletionImage(
            img,
            "Completed by " + result.usedEngine + " (" + img.width + "×" + img.height + "px, mode: " + result.resolvedMode + ")."
          );
          URL.revokeObjectURL(url);
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          throw new Error("Could not display the completed image.");
        };
        img.src = url;
      })
      .catch(function (error) {
        console.warn("API completion unavailable; using local engine.", error);
        toast(error.message + " Falling back to local vision.");
        runCompleteLocal();
      })
      .then(function () { document.getElementById("complete-run").disabled = false; });
  }

  function runRegenerate() {
    if (!completeImage) return;
    try {
      var mode = document.getElementById("complete-axis").value;
      var res = KolamVision.regenerateFromHalf(imageToImageData(completeImage), mode);
      if (!res) { toast("Couldn't detect a dot grid in the drawn half — try the pixel mirror instead."); return; }
      var canvas = renderToCanvas(res.pattern, { scale: 2, bg: COLORS.cardBg });
      var outC = document.getElementById("complete-out");
      var w = res.pattern.dimensions.width, h = res.pattern.dimensions.height;
      outC.width = w; outC.height = h;
      outC.getContext("2d").drawImage(canvas, 0, 0, w, h);
      completeOutput = { width: w, height: h, data: outC.getContext("2d").getImageData(0, 0, w, h).data };
      document.getElementById("complete-download").disabled = false;
      document.getElementById("complete-status").textContent =
        "Clean rebuilt kolam (" + res.info.grid + " grid, tile confidence " + res.info.avgConf + "%).";
    } catch (err) {
      console.error(err);
      toast("Clean rebuild failed: " + (err && err.message ? err.message : err));
    }
  }

  function downloadComplete() {
    if (!completeOutput) return;
    var c = document.createElement("canvas");
    c.width = completeOutput.width; c.height = completeOutput.height;
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(completeOutput.data), c.width, c.height), 0, 0);
    c.toBlob(function (blob) {
      if (blob) downloadBlob(blob, "kolam-completed.png");
      else toast("PNG export failed.");
    }, "image/png");
  }

  /* ---------------- part-to-whole reconstruction ---------------- */
  var fragmentImage = null;
  var fragmentSourceFile = null;
  var fragmentOutput = null;

  function onFragmentFile(file) {
    fragmentSourceFile = file;
    readFileToImage(file, function (img) {
      fragmentImage = img;
      drawImageFit(img, document.getElementById("fragment-in"), 360);
      document.getElementById("fragment-run").disabled = false;
      document.getElementById("fragment-status").textContent =
        "Fragment loaded (" + (img.naturalWidth || img.width) + "×" + (img.naturalHeight || img.height) + "). Analyzing its structure…";
      runFragmentReconstruction();
    });
  }

  function humanizeFragmentValue(value) {
    return String(value || "unknown").replace(/-/g, " ").replace(/\b\w/g, function (letter) {
      return letter.toUpperCase();
    });
  }

  function renderFragmentAnalysis(meta) {
    var confidence = parseFloat(meta.confidence || 0);
    document.getElementById("fragment-analysis").innerHTML =
      '<div class="fragment-summary">' +
        '<div><span class="overline">Prediction report</span><b style="font-family:Georgia,serif;color:#2b1714">Symmetry hypothesis</b></div>' +
        '<div class="fragment-confidence">' + Math.round(confidence) + '%<small>confidence</small></div>' +
      '</div>' +
      '<div class="fragment-metrics">' +
        '<div class="fragment-metric"><span>Position</span><b>' + humanizeFragmentValue(meta.placement) + '</b></div>' +
        '<div class="fragment-metric"><span>Style</span><b>' + humanizeFragmentValue(meta.style) + '</b></div>' +
        '<div class="fragment-metric"><span>Grid clue</span><b>' + (meta.grid || "Not detected") + '</b></div>' +
        '<div class="fragment-metric"><span>Ink coverage</span><b>' + (meta.coverage || "—") + '%</b></div>' +
        '<div class="fragment-metric"><span>Grid spacing</span><b>' + (meta.spacing || "—") + ' px</b></div>' +
        '<div class="fragment-metric"><span>Engine</span><b>' + humanizeFragmentValue(meta.engine || "browser fallback") + '</b></div>' +
      '</div>';
  }

  function finishFragmentImage(img, meta) {
    var data = imageToImageData(img);
    fragmentOutput = {
      width: data.width,
      height: data.height,
      data: new Uint8ClampedArray(data.data)
    };
    putImageDataToCanvas(fragmentOutput, document.getElementById("fragment-out"), 440);
    document.getElementById("fragment-download").disabled = false;
    renderFragmentAnalysis(meta);
    document.getElementById("fragment-status").textContent =
      "Predicted a " + data.width + "×" + data.height + " complete kolam from the supplied fragment.";
  }

  function transformFragmentCanvas(source, placement) {
    var canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    var ctx = canvas.getContext("2d");
    ctx.save();
    if (placement === "top-right") { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    else if (placement === "bottom-left") { ctx.translate(0, canvas.height); ctx.scale(1, -1); }
    else if (placement === "bottom-right") { ctx.translate(canvas.width, canvas.height); ctx.scale(-1, -1); }
    ctx.drawImage(source, 0, 0);
    ctx.restore();
    return canvas;
  }

  function rotateSquare(source, turns) {
    var canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    var ctx = canvas.getContext("2d");
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(turns * Math.PI / 2);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);
    return canvas;
  }

  function runFragmentLocal() {
    var naturalW = fragmentImage.naturalWidth || fragmentImage.width;
    var naturalH = fragmentImage.naturalHeight || fragmentImage.height;
    var scale = Math.min(1, 600 / Math.max(naturalW, naturalH));
    var source = document.createElement("canvas");
    source.width = Math.max(2, Math.round(naturalW * scale));
    source.height = Math.max(2, Math.round(naturalH * scale));
    source.getContext("2d").drawImage(fragmentImage, 0, 0, source.width, source.height);
    var placement = document.getElementById("fragment-placement").value;
    if (placement === "auto") placement = "top-left";
    var style = document.getElementById("fragment-style").value;
    var canonical = transformFragmentCanvas(source, placement);
    var output = document.createElement("canvas");
    var ctx;

    if (style === "rotational4") {
      var q = Math.max(canonical.width, canonical.height);
      var tile = document.createElement("canvas");
      tile.width = q; tile.height = q;
      tile.getContext("2d").drawImage(canonical, (q - canonical.width) / 2, (q - canonical.height) / 2);
      output.width = q * 2; output.height = q * 2; ctx = output.getContext("2d");
      ctx.drawImage(tile, 0, 0);
      ctx.drawImage(rotateSquare(tile, -1), q, 0);
      ctx.drawImage(rotateSquare(tile, 1), 0, q);
      ctx.drawImage(rotateSquare(tile, 2), q, q);
    } else {
      var w = canonical.width, h = canonical.height;
      output.width = w * 2; output.height = h * 2; ctx = output.getContext("2d");
      ctx.drawImage(canonical, 0, 0);
      ctx.save(); ctx.translate(w * 2, 0); ctx.scale(-1, 1); ctx.drawImage(canonical, 0, 0); ctx.restore();
      ctx.save(); ctx.translate(0, h * 2); ctx.scale(1, -1); ctx.drawImage(canonical, 0, 0); ctx.restore();
      ctx.save(); ctx.translate(w * 2, h * 2); ctx.scale(-1, -1); ctx.drawImage(canonical, 0, 0); ctx.restore();
    }
    var data = output.getContext("2d").getImageData(0, 0, output.width, output.height);
    fragmentOutput = { width: output.width, height: output.height, data: new Uint8ClampedArray(data.data) };
    putImageDataToCanvas(fragmentOutput, document.getElementById("fragment-out"), 440);
    document.getElementById("fragment-download").disabled = false;
    renderFragmentAnalysis({
      confidence: 48,
      placement: placement,
      style: style,
      grid: "Local fallback",
      coverage: "—",
      spacing: "—",
      engine: "browser fallback"
    });
    document.getElementById("fragment-status").textContent =
      "Backend unavailable; generated a browser-based symmetry hypothesis.";
  }

  function runFragmentReconstruction() {
    if (!fragmentImage) return;
    if (!backendAvailable || !fragmentSourceFile) {
      runFragmentLocal();
      return;
    }
    var placement = document.getElementById("fragment-placement").value;
    var style = document.getElementById("fragment-style").value;
    var runButton = document.getElementById("fragment-run");
    runButton.disabled = true;
    document.getElementById("fragment-status").textContent =
      "Analyzing fragment, predicting placement, and generating the complete kolam…";
    var form = new FormData();
    form.append("image", fragmentSourceFile, fragmentSourceFile.name || "fragment.png");
    form.append("placement", placement);
    form.append("style", style);

    fetch("/api/reconstruct", { method: "POST", body: form })
      .then(function (response) {
        if (!response.ok) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            throw new Error(body.error || "Fragment reconstruction failed.");
          });
        }
        var meta = {
          engine: response.headers.get("X-Kolamaya-Engine"),
          placement: response.headers.get("X-Kolamaya-Placement"),
          style: response.headers.get("X-Kolamaya-Style"),
          confidence: response.headers.get("X-Kolamaya-Confidence"),
          coverage: response.headers.get("X-Kolamaya-Coverage"),
          grid: response.headers.get("X-Kolamaya-Grid"),
          spacing: response.headers.get("X-Kolamaya-Spacing")
        };
        return response.blob().then(function (blob) { return { blob: blob, meta: meta }; });
      })
      .then(function (result) {
        var url = URL.createObjectURL(result.blob);
        var image = new Image();
        image.onload = function () {
          finishFragmentImage(image, result.meta);
          URL.revokeObjectURL(url);
          runButton.disabled = false;
        };
        image.onerror = function () {
          URL.revokeObjectURL(url);
          runButton.disabled = false;
          toast("The prediction was generated but could not be displayed.");
        };
        image.src = url;
      })
      .catch(function (error) {
        console.warn("Fragment API unavailable; using local fallback.", error);
        toast(error.message + " Using browser symmetry instead.");
        runFragmentLocal();
        runButton.disabled = false;
      });
  }

  function downloadFragment() {
    if (!fragmentOutput) return;
    var canvas = document.createElement("canvas");
    canvas.width = fragmentOutput.width;
    canvas.height = fragmentOutput.height;
    canvas.getContext("2d").putImageData(
      new ImageData(new Uint8ClampedArray(fragmentOutput.data), canvas.width, canvas.height), 0, 0
    );
    canvas.toBlob(function (blob) {
      if (blob) downloadBlob(blob, "kolamaya-fragment-reconstruction.png");
      else toast("PNG export failed.");
    }, "image/png");
  }

  /* ---------------- kolam recreator ---------------- */
  var recreatorImage = null;
  var recreatorSourceFile = null;
  var recreatorOutput = null;

  function onRecreatorFile(file) {
    recreatorSourceFile = file;
    readFileToImage(file, function (img) {
      recreatorImage = img;
      drawImageFit(img, document.getElementById("recreator-in"), 360);
      document.getElementById("recreator-run").disabled = false;
      document.getElementById("recreator-status").textContent =
        "Image loaded (" + (img.naturalWidth || img.width) + "×" + (img.naturalHeight || img.height) + "). Recognizing its structure…";
      runRecreator();
    });
  }

  function renderRecreatorAnalysis(meta) {
    var confidence = parseFloat(meta.confidence || 0);
    document.getElementById("recreator-analysis").innerHTML =
      '<div class="fragment-summary">' +
        '<div><span class="overline">Recreation report</span><b style="font-family:Georgia,serif;color:#2b1714">Digital rebuild</b></div>' +
        '<div class="fragment-confidence">' + Math.round(confidence) + '%<small>recreation score</small></div>' +
      '</div>' +
      '<div class="fragment-metrics">' +
        '<div class="fragment-metric"><span>Method</span><b>' + humanizeFragmentValue(meta.method) + '</b></div>' +
        '<div class="fragment-metric"><span>Grid</span><b>' + (meta.grid || "Not detected") + '</b></div>' +
        '<div class="fragment-metric"><span>Cells</span><b>' + (meta.cells || "—") + '</b></div>' +
        '<div class="fragment-metric"><span>Tile fidelity</span><b>' + (meta.tileConfidence || "0") + '%</b></div>' +
        '<div class="fragment-metric"><span>Symmetry</span><b>' + (meta.symmetry || "—") + '%</b></div>' +
        '<div class="fragment-metric"><span>Palette</span><b>' + humanizeFragmentValue(meta.palette) + '</b></div>' +
      '</div>';
  }

  function finishRecreatorImage(img, meta) {
    var data = imageToImageData(img);
    recreatorOutput = {
      width: data.width,
      height: data.height,
      data: new Uint8ClampedArray(data.data)
    };
    putImageDataToCanvas(recreatorOutput, document.getElementById("recreator-out"), 440);
    document.getElementById("recreator-download").disabled = false;
    renderRecreatorAnalysis(meta);
    document.getElementById("recreator-status").textContent =
      "Recreated as a " + data.width + "×" + data.height + " clean digital kolam using " + humanizeFragmentValue(meta.method) + ".";
  }

  function recreatorPalette(name, background) {
    if (name === "monochrome") return { bg: [255, 253, 248], ink: [35, 24, 21] };
    if (name === "original") {
      var brightness = (background[0] + background[1] + background[2]) / 3;
      return { bg: background, ink: brightness > 128 ? [25, 20, 18] : [255, 250, 240] };
    }
    return { bg: [72, 29, 36], ink: [255, 250, 240] };
  }

  function runRecreatorLocal() {
    var naturalW = recreatorImage.naturalWidth || recreatorImage.width;
    var naturalH = recreatorImage.naturalHeight || recreatorImage.height;
    var scale = Math.min(1, 900 / Math.max(naturalW, naturalH));
    var source = document.createElement("canvas");
    source.width = Math.max(2, Math.round(naturalW * scale));
    source.height = Math.max(2, Math.round(naturalH * scale));
    var sourceCtx = source.getContext("2d");
    sourceCtx.drawImage(recreatorImage, 0, 0, source.width, source.height);
    var imageData = sourceCtx.getImageData(0, 0, source.width, source.height);
    var pixels = imageData.data;
    var background = [pixels[0], pixels[1], pixels[2]];
    var paletteName = document.getElementById("recreator-palette").value;
    var palette = recreatorPalette(paletteName, background);
    var output = sourceCtx.createImageData(source.width, source.height);
    for (var i = 0; i < pixels.length; i += 4) {
      var difference = Math.max(
        Math.abs(pixels[i] - background[0]),
        Math.abs(pixels[i + 1] - background[1]),
        Math.abs(pixels[i + 2] - background[2])
      );
      var color = difference > 55 ? palette.ink : palette.bg;
      output.data[i] = color[0]; output.data[i + 1] = color[1]; output.data[i + 2] = color[2]; output.data[i + 3] = 255;
    }
    recreatorOutput = { width: output.width, height: output.height, data: new Uint8ClampedArray(output.data) };
    putImageDataToCanvas(recreatorOutput, document.getElementById("recreator-out"), 440);
    document.getElementById("recreator-download").disabled = false;
    renderRecreatorAnalysis({
      confidence: 55,
      method: "browser clean trace",
      grid: "Not analyzed",
      cells: "—",
      tileConfidence: 0,
      symmetry: "—",
      palette: paletteName
    });
    document.getElementById("recreator-status").textContent =
      "Backend unavailable; produced a browser-based clean trace.";
  }

  function runRecreator() {
    if (!recreatorImage) return;
    if (!backendAvailable || !recreatorSourceFile) {
      runRecreatorLocal();
      return;
    }
    var method = document.getElementById("recreator-method").value;
    var palette = document.getElementById("recreator-palette").value;
    var thickness = document.getElementById("recreator-thickness").value;
    var runButton = document.getElementById("recreator-run");
    runButton.disabled = true;
    document.getElementById("recreator-status").textContent =
      "Analyzing the grid and redrawing the kolam with clean digital geometry…";
    var form = new FormData();
    form.append("image", recreatorSourceFile, recreatorSourceFile.name || "kolam.png");
    form.append("method", method);
    form.append("palette", palette);
    form.append("thickness", thickness);

    fetch("/api/recreate", { method: "POST", body: form })
      .then(function (response) {
        if (!response.ok) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            throw new Error(body.error || "Kolam recreation failed.");
          });
        }
        var meta = {
          engine: response.headers.get("X-Kolamaya-Engine"),
          method: response.headers.get("X-Kolamaya-Method"),
          palette: response.headers.get("X-Kolamaya-Palette"),
          confidence: response.headers.get("X-Kolamaya-Confidence"),
          grid: response.headers.get("X-Kolamaya-Grid"),
          gridRegularity: response.headers.get("X-Kolamaya-Grid-Regularity"),
          tileConfidence: response.headers.get("X-Kolamaya-Tile-Confidence"),
          symmetry: response.headers.get("X-Kolamaya-Symmetry"),
          cells: response.headers.get("X-Kolamaya-Cells")
        };
        return response.blob().then(function (blob) { return { blob: blob, meta: meta }; });
      })
      .then(function (result) {
        var url = URL.createObjectURL(result.blob);
        var image = new Image();
        image.onload = function () {
          finishRecreatorImage(image, result.meta);
          URL.revokeObjectURL(url);
          runButton.disabled = false;
        };
        image.onerror = function () {
          URL.revokeObjectURL(url);
          runButton.disabled = false;
          toast("The recreation was generated but could not be displayed.");
        };
        image.src = url;
      })
      .catch(function (error) {
        console.warn("Recreator API unavailable; using local trace.", error);
        toast(error.message + " Using browser tracing instead.");
        runRecreatorLocal();
        runButton.disabled = false;
      });
  }

  function downloadRecreated() {
    if (!recreatorOutput) return;
    var canvas = document.createElement("canvas");
    canvas.width = recreatorOutput.width;
    canvas.height = recreatorOutput.height;
    canvas.getContext("2d").putImageData(
      new ImageData(new Uint8ClampedArray(recreatorOutput.data), canvas.width, canvas.height), 0, 0
    );
    canvas.toBlob(function (blob) {
      if (blob) downloadBlob(blob, "kolamaya-recreated.png");
      else toast("PNG export failed.");
    }, "image/png");
  }

  /* ---------------- analyzer ---------------- */
  var analyzeImageData = null;
  var analyzeSourceBlob = null;
  var analyzeSourceImage = null;

  function onAnalyzeFile(file) {
    analyzeSourceBlob = file;
    readFileToImage(file, function (img) {
      analyzeSourceImage = img;
      document.getElementById("analyze-status").textContent =
        "Image loaded (" + (img.naturalWidth || img.width) + "×" + (img.naturalHeight || img.height) + "). Analyzing…";
      runAnalyze(imageToImageData(img), img, file);
    });
  }

  function analyzeCurrent() {
    if (!pattern) return;
    var canvas = renderToCanvas(pattern, { scale: 1, bg: COLORS.cardBg });
    var imgData = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    analyzeSourceImage = canvas;
    document.getElementById("analyze-status").textContent = "Analyzing the current kolam…";
    canvas.toBlob(function (blob) {
      analyzeSourceBlob = blob;
      runAnalyze(imgData, canvas, blob);
    }, "image/png");
  }

  function applyAnalysisResult(imgData, srcImage, res, sourceLabel) {
    analyzeImageData = imgData;
    renderAnalyzeResults(res);
    drawAnnotated(imgData, res, srcImage);
    document.getElementById("analyze-run").disabled = false;
    document.getElementById("analyze-status").textContent =
      "Analyzed " + res.width + "×" + res.height + "px with " + sourceLabel + ".";
  }

  function runAnalyzeLocal(imgData, srcImage) {
    try {
      var localResult = KolamVision.analyzeImage(imgData, { maxDim: 400 });
      localResult.engine = "browser-hybrid-fallback";
      applyAnalysisResult(imgData, srcImage, localResult, "the browser fallback");
    } catch (err) {
      console.error(err);
      toast("Analysis failed: " + (err && err.message ? err.message : err));
    }
  }

  function runAnalyze(imgData, srcImage, sourceBlob) {
    analyzeImageData = imgData;
    analyzeSourceImage = srcImage || analyzeSourceImage;
    sourceBlob = sourceBlob || analyzeSourceBlob;
    if (!backendAvailable || !sourceBlob) {
      runAnalyzeLocal(imgData, srcImage);
      return;
    }

    var status = document.getElementById("analyze-status");
    status.textContent = "Analyzing with the KOLAMAYA Hybrid Vision API…";
    document.getElementById("analyze-run").disabled = true;
    var form = new FormData();
    form.append("image", sourceBlob, sourceBlob.name || "kolam.png");

    fetch("/api/analyze", { method: "POST", body: form })
      .then(function (response) {
        if (!response.ok) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            throw new Error(body.error || "Backend analysis failed.");
          });
        }
        return response.json();
      })
      .then(function (result) {
        applyAnalysisResult(imgData, srcImage, result, "KOLAMAYA Hybrid Vision v1");
      })
      .catch(function (error) {
        console.warn("API analysis unavailable; using browser fallback.", error);
        toast("Vision API unavailable. Using the browser fallback.");
        runAnalyzeLocal(imgData, srcImage);
      });
  }

  function pct(v) { return Math.round(v); }

  function bar(label, value, opts) {
    var v = Math.max(0, Math.min(100, value));
    return '<div class="metric">' +
      '<div class="m-label"><span>' + label + '</span><b class="m-val">' + pct(v) + '%</b></div>' +
      '<div class="score-track"><div class="score-fill ' + (opts && opts.gold ? "gold" : "") + '" style="width:' + v.toFixed(1) + '%"></div></div>' +
      '</div>';
  }

  function renderAnalyzeResults(res) {
    var html = "";
    if (res.engine) {
      var engineLabel = res.engine === "kolamaya-hybrid-v1" ? "KOLAMAYA Hybrid Vision v1" : "Browser hybrid fallback";
      html += '<div class="engine-pill">' + engineLabel + '</div>';
    }
    // Overall accuracy
    var grade = res.accuracy >= 85 ? "Excellent" : res.accuracy >= 65 ? "Good" : res.accuracy >= 40 ? "Fair" : "Poor";
    html += '<div style="display:flex;align-items:center;gap:1rem;margin-bottom:.75rem">' +
      '<div class="accuracy-big">' + res.accuracy + '<small> / 100</small></div>' +
      '<div><div style="font-weight:700;color:#78350f">' + grade + '</div>' +
      '<div style="font-size:.75rem;color:#a16207">Overall Kolam Accuracy (heuristic)</div></div></div>';

    html += '<div style="margin:1rem 0 .4rem;font-size:.8rem;font-weight:700;color:#7c4a12;text-transform:uppercase;letter-spacing:.03em">Symmetry</div>';
    html += bar("Vertical mirror", res.symmetry.vertical);
    html += bar("Horizontal mirror", res.symmetry.horizontal);
    html += bar("Rotational (180°)", res.symmetry.rotational);

    html += '<div style="margin:1rem 0 .4rem;font-size:.8rem;font-weight:700;color:#7c4a12;text-transform:uppercase;letter-spacing:.03em">Structure</div>';
    var lat = res.lattice;
    html += '<div class="kv"><b>Dot grid:</b> ' + (lat.detected
      ? lat.rows + "×" + lat.cols + " · " + lat.dotCount + " dots · spacing " + lat.spacing.toFixed(1) + "px"
      : "not detected") + "</div>";
    html += bar("Grid regularity", lat.detected ? lat.regularity : 0);
    html += '<div class="kv"><b>Ink coverage:</b> ' + (res.inkFraction * 100).toFixed(1) + "% of the image</div>";

    html += '<div style="margin:1rem 0 .4rem;font-size:.8rem;font-weight:700;color:#7c4a12;text-transform:uppercase;letter-spacing:.03em">Curve tiles</div>';
    if (res.tiles) {
      html += bar("Tile-match confidence", res.tiles.avgConf * 100, { gold: true });
      var chips = "";
      var dist = res.tiles.distribution;
      var ids = Object.keys(dist).sort(function (a, b) { return dist[b] - dist[a]; }).slice(0, 10);
      ids.forEach(function (id) { chips += '<span class="chip">tile <b>' + id + "</b> ×" + dist[id] + "</span>"; });
      html += '<div class="chips">' + chips + "</div>";
    } else {
      html += '<div class="kv">Tile recognition needs a detected dot grid.</div>';
    }

    document.getElementById("analyze-results").innerHTML =
      '<h3>Results</h3>' + html;
  }

  function drawAnnotated(imgData, res, srcImage) {
    var canvas = document.getElementById("analyze-canvas");
    var maxDim = 520;
    var scale = Math.min(1, maxDim / Math.max(imgData.width, imgData.height));
    canvas.width = Math.max(1, Math.round(imgData.width * scale));
    canvas.height = Math.max(1, Math.round(imgData.height * scale));
    var ctx = canvas.getContext("2d");
    // draw the source image (or a light-rendered version of the image data)
    var src = document.createElement("canvas");
    src.width = imgData.width; src.height = imgData.height;
    src.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(imgData.data), imgData.width, imgData.height), 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);

    var s = scale;
    var lat = res.lattice;
    ctx.lineWidth = 1;
    // grid lines
    if (lat.detected) {
      ctx.strokeStyle = "rgba(59,130,246,0.55)";
      lat.rowsAt.forEach(function (y) {
        ctx.beginPath(); ctx.moveTo(0, y * s); ctx.lineTo(canvas.width, y * s); ctx.stroke();
      });
      lat.colsAt.forEach(function (x) {
        ctx.beginPath(); ctx.moveTo(x * s, 0); ctx.lineTo(x * s, canvas.height); ctx.stroke();
      });
    }
    // detected dots
    ctx.fillStyle = "#ef4444";
    lat.dots.forEach(function (d) {
      ctx.beginPath();
      ctx.arc(d.x * s, d.y * s, Math.max(1.5, 2.2 * s), 0, Math.PI * 2);
      ctx.fill();
    });
    var cap = document.getElementById("analyze-cap");
    cap.textContent = lat.detected
      ? "Detected " + lat.dotCount + " dots on a " + lat.rows + "×" + lat.cols + " grid (spacing " + lat.spacing.toFixed(1) + "px)"
      : "No dot grid detected — " + lat.dotCount + " candidate dots";
  }

  /* ---------------- boot ---------------- */
  function boot() {
    syncControls();
    generate();
    bind();
    checkBackend();

    // tabs
    document.querySelectorAll(".tab").forEach(function (t) {
      t.addEventListener("click", function () { switchTab(t.getAttribute("data-tab")); });
    });

    // half completion
    bindDropZone("complete-drop", "complete-file", onCompleteFile);
    document.getElementById("complete-run").addEventListener("click", runComplete);
    document.getElementById("complete-tiles").addEventListener("click", runRegenerate);
    document.getElementById("complete-download").addEventListener("click", downloadComplete);
    document.getElementById("complete-axis").addEventListener("change", function () {
      if (completeImage) runComplete();
    });
    document.getElementById("complete-engine").addEventListener("change", function () {
      if (completeImage) runComplete();
    });

    // part-to-whole reconstruction
    bindDropZone("fragment-drop", "fragment-file", onFragmentFile);
    document.getElementById("fragment-run").addEventListener("click", runFragmentReconstruction);
    document.getElementById("fragment-download").addEventListener("click", downloadFragment);
    document.getElementById("fragment-placement").addEventListener("change", function () {
      if (fragmentImage) runFragmentReconstruction();
    });
    document.getElementById("fragment-style").addEventListener("change", function () {
      if (fragmentImage) runFragmentReconstruction();
    });

    // kolam recreator
    bindDropZone("recreator-drop", "recreator-file", onRecreatorFile);
    document.getElementById("recreator-run").addEventListener("click", runRecreator);
    document.getElementById("recreator-download").addEventListener("click", downloadRecreated);
    document.getElementById("recreator-method").addEventListener("change", function () {
      if (recreatorImage) runRecreator();
    });
    document.getElementById("recreator-palette").addEventListener("change", function () {
      if (recreatorImage) runRecreator();
    });
    document.getElementById("recreator-thickness").addEventListener("input", function (event) {
      document.getElementById("recreator-thickness-value").textContent = event.target.value;
    });
    document.getElementById("recreator-thickness").addEventListener("change", function () {
      if (recreatorImage) runRecreator();
    });

    // analyzer
    bindDropZone("analyze-drop", "analyze-file", onAnalyzeFile);
    document.getElementById("analyze-run").addEventListener("click", function () {
      if (analyzeImageData) runAnalyze(analyzeImageData, analyzeSourceImage, analyzeSourceBlob);
    });
    document.getElementById("analyze-current").addEventListener("click", analyzeCurrent);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
