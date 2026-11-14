/**
 * Theme bootstrap for extension pages. Loaded as a classic script in <head>
 * so the right palette is on <html> before first paint (no flash).
 *
 * Preference lives in chrome.storage.local.userTheme: system | light | dark.
 * A localStorage mirror makes the very first frame correct, because
 * chrome.storage is asynchronous.
 */
(function () {
  var root = document.documentElement;
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  var pref = "light";

  // Light unless the user picked Dark or System in Settings.
  function normalize(value) {
    return value === "dark" || value === "system" ? value : "light";
  }

  function apply() {
    var resolved = pref === "system" ? (media.matches ? "dark" : "light") : pref;
    root.dataset.theme = resolved;
    root.dataset.themePref = pref;
  }

  // Colour is one setting (dynamic | calm | plain); the palette and how much
  // of the interface wears it follow from it. Dynamic picks a new palette
  // each time a page opens, never the same one twice in a row. Mirrored in
  // localStorage so the first frame already has the right glass.
  var DYNAMIC = ["ocean", "aurora", "sunset", "forest", "balanced"];
  var current = null;
  function setColour(mode) {
    var m = mode === "calm" || mode === "plain" ? mode : "dynamic";
    if (m === current) return;
    current = m;
    var palette = "balanced";
    var tint = "full";
    if (m === "plain") {
      palette = "mono";
      tint = "none";
    } else if (m === "dynamic") {
      var last = null;
      try {
        last = localStorage.getItem("ss-last-palette");
      } catch (e) {}
      var choices = DYNAMIC.filter(function (p) {
        return p !== last;
      });
      palette = choices[Math.floor(Math.random() * choices.length)];
      tint = "hybrid";
      try {
        localStorage.setItem("ss-last-palette", palette);
      } catch (e) {}
    }
    root.dataset.colour = m;
    root.dataset.palette = palette;
    root.dataset.tint = tint;
    try {
      localStorage.setItem("ss-colour", m);
    } catch (e) {}
  }

  try {
    pref = normalize(localStorage.getItem("ss-theme"));
    setColour(localStorage.getItem("ss-colour"));
  } catch (e) {
    setColour();
  }
  apply();

  media.addEventListener("change", apply);

  function adopt(value) {
    pref = normalize(value);
    try {
      localStorage.setItem("ss-theme", pref);
    } catch (e) {}
    apply();
  }

  try {
    chrome.storage.local.get(["userTheme", "uiColour"], function (data) {
      adopt(data && data.userTheme);
      setColour(data && data.uiColour);
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "local") return;
      if (changes.userTheme) adopt(changes.userTheme.newValue);
      if (changes.uiColour) setColour(changes.uiColour.newValue);
    });
  } catch (e) {}
})();
