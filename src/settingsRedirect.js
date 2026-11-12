// Settings are a view of the Gallery. chrome://extensions "Options" and old
// bookmarks still land here, so forward to it, keeping any section anchor.
(() => {
  const section = location.hash.replace(/^#/, "");
  location.replace(`gallery.html#settings${section ? `/${section}` : ""}`);
})();
