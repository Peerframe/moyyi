export function renderCurrent(items) {
  return items.length ? items.map(x => x.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')).join('|') : '(empty)';
}
