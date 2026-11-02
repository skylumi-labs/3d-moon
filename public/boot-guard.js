// Loaded from index.html as a classic, blocking script before the module (issue 187). A file and not an inline script: skylumi.org's
// /3d-moon CSP header has no hash for it, and both policies apply, so an inline guard never ran on the site (persona run 2026-10-26).
// A start-up failure (no WebGL2, a module that did not load, an early throw) must say so: without this the title splash or the
// "Loading the Moon" line stays up for ever. Only counts until the first frame is drawn (window.__moon.ready); main.ts's own fail() shows the same panel.
(function () {
  var shown = false;
  function fatal(msg) {
    var m = window.__moon;
    // window.__moonHoldErr: the app's GPU-reset retry card (src/ui/gpuResetCard.ts) owns the panel; the throw that follows it must not replace it.
    if (shown || window.__moonHoldErr || (m && m.ready)) return;
    shown = true;
    var el = document.getElementById('err');
    if (!el) return;
    el.textContent = 'The Moon could not start.\n' + ((m && m.error) || msg || 'Unknown error') + '\nReload the page to try again.';
    el.style.display = 'grid';
    el.style.zIndex = '100';
    var gone = document.querySelectorAll('.splash, #preview');
    for (var i = 0; i < gone.length; i++) gone[i].parentNode.removeChild(gone[i]);
    document.body.classList.remove('intro-on');
  }
  window.__moonFatal = fatal;
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window) { if (t.tagName === 'SCRIPT') fatal('Could not load ' + (t.src || 'a script') + '.'); return; }
    fatal(e.message || 'Script error');
  }, true);
  window.addEventListener('unhandledrejection', function (e) { var r = e.reason; fatal(String((r && r.message) || r)); });
  try {
    var probe = document.createElement('canvas');
    var probeGl = probe.getContext('webgl2');
    if (!probeGl) fatal('This page needs WebGL2, and this browser did not provide it. Check that hardware acceleration is on.');
    else { try { var lose = probeGl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); } catch (e2) { /* releasing the probe is a courtesy; never a reason to block the page */ } } // the probe only asked; give its context back before the viewer makes its own
  } catch (err) { fatal('This page needs WebGL2, and this browser did not provide it.'); }
})();
