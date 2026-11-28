/**
 * Legacy standalone annotation URL redirect (annotate.html?id=<capture id>).
 *
 * Annotate Studio now lives directly inside Swift Gallery (`gallery.html#annotate`),
 * so any bookmark or legacy link routes seamlessly into the full studio without
 * maintaining a second isolated editor window.
 */
const params = new URLSearchParams(location.search);
const idsParam = params.get("ids");
const idParam = params.get("id");

let hash = "#annotate";
if (idsParam) {
  const clean = idsParam
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => n > 0);
  if (clean.length) hash = `#annotate/${clean.join(",")}`;
} else if (idParam && Number(idParam) > 0) {
  hash = `#annotate/${Number(idParam)}`;
}

location.replace(`gallery.html${hash}`);

