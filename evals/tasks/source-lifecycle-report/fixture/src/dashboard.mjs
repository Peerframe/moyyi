import { readStable } from "./stable-read.mjs";

export function createDashboard(options, storage) {
  const directory = options.directory;
  const panels = [...options.panels];
  return {
    async render() {
      const pieces = [];
      for (const panel of panels) {
        pieces.push(await readStable(storage, `${directory}/${panel}.txt`));
      }
      return pieces.join("\n");
    },
  };
}
