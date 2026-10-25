export type Preset = {
  id: string;
  label: string;
  prompt: string;
};

export const PRESETS: Preset[] = [
  {
    id: "camera",
    label: "Vintage camera",
    prompt: "a vintage 35mm rangefinder camera, leather-wrapped body, chrome lens barrel, worn brass accents",
  },
  {
    id: "lantern",
    label: "Mushroom lantern",
    prompt: "a fantasy mushroom lantern with a mossy stone base, carved wooden handle and soft glowing gills",
  },
  {
    id: "drone",
    label: "Scout drone",
    prompt: "a compact sci-fi scout drone with brushed titanium plating, four folded rotors and a cyan sensor eye",
  },
  {
    id: "teapot",
    label: "Ceramic teapot",
    prompt: "a hand-thrown ceramic teapot with matte sage glaze, bamboo handle and a small spout",
  },
  {
    id: "chest",
    label: "Treasure chest",
    prompt: "a weathered wooden treasure chest with iron bands, open lid and a few gold coins inside",
  },
];

export const EXAMPLE_PROMPT = PRESETS[0].prompt;
