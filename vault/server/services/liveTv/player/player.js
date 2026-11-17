/* Vault Live TV player (docs/live-tv.md). Loaded by index.html in a frame on the Live TV page.
   Messages in (from the Live TV page, same origin only):  { type: 'play', url }  |  { type: 'stop' }
   Messages out (to the page):  { type: 'ready' } | { type: 'status', state: 'loading'|'playing'|'failed', url, problem } */
(function () {
  'use strict';
  var video = document.getElementById('video');
  var msg = document.getElementById('msg');
  var hls = null;
  var current = '';
  var timer = null;
  var reported = false;
  var START_LIMIT_MS = 20000;

  function tell(data) {
    data.source = 'vault-live-tv-player';
    try { window.parent.postMessage(data, window.location.origin); } catch (e) { /* page gone */ }
  }
  function show(text) {
    if (text) { msg.textContent = text; msg.hidden = false; } else { msg.hidden = true; }
  }
  function stop() {
    clearTimeout(timer);
    if (hls) { try { hls.destroy(); } catch (e) { /* ignore */ } hls = null; }
    video.removeAttribute('src');
    try { video.load(); } catch (e) { /* ignore */ }
    current = '';
  }
  function failed(problem) {
    if (reported) return;
    reported = true;
    var url = current;
    stop();
    show('This stream did not play here.');
    tell({ type: 'status', state: 'failed', url: url, problem: problem });
  }
  function started() {
    if (reported) return;
    reported = true;
    clearTimeout(timer);
    show('');
    tell({ type: 'status', state: 'playing', url: current });
  }
  function startPlayback() {
    var p = video.play();
    if (p && p.catch) {
      p.catch(function (err) {
        // Browsers refuse sound until the person has pressed something on the page: start muted and let them unmute.
        if (err && err.name === 'NotAllowedError') { video.muted = true; video.play().catch(function () { /* the controls are there */ }); }
      });
    }
  }

  function play(url) {
    stop();
    reported = false;
    current = url;
    show('Connecting…');
    tell({ type: 'status', state: 'loading', url: url });
    timer = setTimeout(function () { failed('No picture after 20 seconds. The channel may be off air, busy, or only shown in its own country.'); }, START_LIMIT_MS);

    var isHls = /\.m3u8(\?|$)/i.test(url) || !/\.(mp4|webm|ogg|mp3|aac)(\?|$)/i.test(url);
    if (isHls && window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({ enableWorker: false, lowLatencyMode: false, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 1, fragLoadingMaxRetry: 2 });
      hls.on(window.Hls.Events.ERROR, function (event, data) {
        if (!data || !data.fatal) return;
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          var code = data.response && data.response.code;
          if (code === 403 || code === 401) failed('The broadcaster refused this stream (it may only be shown in its own country).');
          else if (code === 404 || code === 410) failed('The stream is gone (the broadcaster moved or ended it).');
          else failed('The stream could not be reached. Many broadcasters only let their own website play it; try VLC.');
        } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          failed('The stream started but the browser cannot play its format; try VLC.');
        } else {
          failed('The stream could not be played here; try VLC.');
        }
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, startPlayback);
    } else {
      // Safari plays these streams itself; other files go straight to the video element too.
      video.src = url;
      startPlayback();
    }
  }

  video.addEventListener('playing', started);
  video.addEventListener('error', function () { if (current) failed('The browser could not play this stream; try VLC.'); });

  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    var data = event.data || {};
    if (data.type === 'play' && typeof data.url === 'string' && /^https?:\/\//i.test(data.url)) play(data.url);
    if (data.type === 'stop') { stop(); show('Choose a channel to watch.'); }
  });

  tell({ type: 'ready' });
})();
