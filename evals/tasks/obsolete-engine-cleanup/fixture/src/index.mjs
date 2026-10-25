import { renderLegacy } from './legacy.mjs';
import { renderCurrent } from './current.mjs';
export function render(items) {
  return process.env.USE_LEGACY === '1' ? renderLegacy(items) : renderCurrent(items);
}
