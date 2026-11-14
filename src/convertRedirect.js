// The Batch Converter is a view of the Gallery. Old links and bookmarks to
// convert.html (with or without ?ids=…) still land here, so forward them.
(() => {
  const ids = new URLSearchParams(location.search).get("ids");
  location.replace(`gallery.html#convert${ids ? `/${ids}` : ""}`);
})();
