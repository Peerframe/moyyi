// Renders the code city. Pages create one City on enter and call dispose() on leave.
export class City {
  constructor(win, fonts) {
    this.win = win;
    this.fonts = fonts;
    this.width = 0;
    this.relayouts = 0;
    win.addEventListener("resize", this.onResize.bind(this));
    fonts.addEventListener("loadingdone", () => this.relayout());
  }

  onResize() {
    this.width += 1;
    this.relayout();
  }

  relayout() {
    this.relayouts += 1;
  }

  dispose() {
    this.win.removeEventListener("resize", this.onResize.bind(this));
  }
}
