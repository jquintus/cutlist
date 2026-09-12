// Trust boundary for project text.
//
// A project arrives from an imported file or from a URL fragment, and anyone
// can send someone a share link. Every project-supplied string has to go
// through here before it enters a template literal, in the SVG and in the
// table alike, or a part name becomes stored cross-site scripting with a
// one-click delivery vector.

const REPLACEMENTS = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape a value for use as HTML or SVG text, or inside a quoted attribute. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (character) => REPLACEMENTS[character]);
}
