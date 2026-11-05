// Turns the moyyi Chat design system's tokens.json into the stylesheet its components read:
// shared scales on both theme classes, colours per theme on `.mc-dark` and `.mc-light`.
// This is the same shape the design canvas uses, so components render identically here.

interface Entry {
  readonly name: string;
  readonly value: string | Readonly<Record<string, string>>;
}
interface Family {
  readonly tokens: readonly Entry[];
}
export interface DesignTokens {
  readonly color: Family & { readonly themes: readonly { readonly id: string }[] };
  readonly type: { readonly families: Readonly<Record<string, string>> };
  readonly [family: string]: unknown;
}

const SCALES = ["spacing", "radius", "layout", "timing"] as const;

export function tokensCss(tokens: DesignTokens): string {
  const shared = [
    ...Object.entries(tokens.type.families).map(([name, value]) => `--font-${name}:${value}`),
    ...SCALES.flatMap((family) =>
      ((tokens[family] as Family | undefined)?.tokens ?? []).map(
        (entry) => `--${entry.name}:${String(entry.value)}`,
      ),
    ),
  ];
  const first = tokens.color.themes[0]?.id ?? "";
  const themes = tokens.color.themes.map(({ id }) => {
    const colors = tokens.color.tokens.map((entry) => {
      const value =
        typeof entry.value === "string" ? entry.value : (entry.value[id] ?? entry.value[first]);
      return `--${entry.name}:${value}`;
    });
    return `.mc-${id}{color-scheme:${id};${colors.join(";")}}`;
  });
  const roots = tokens.color.themes.map(({ id }) => `.mc-${id}`).join(",");
  return [
    "/* moyyi Chat — generated from design/tokens.json */",
    `${roots}{${shared.join(";")}}`,
    ...themes,
    "",
  ].join("\n");
}
