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

  try {
    pref = normalize(localStorage.getItem("ss-theme"));
  } catch (e) {}
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
    chrome.storage.local.get(["userTheme"], function (data) {
      adopt(data && data.userTheme);
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === "local" && changes.userTheme) adopt(changes.userTheme.newValue);
    });
  } catch (e) {}
})();
