// Fixed demo outfit catalog for PawTry Together.
//
// Thumbnails are simple hand-drawn SVG icons stored in public/outfits/ -
// clearly stylized demo assets, not photos of real garments. They're shown
// in the picker UI and (optionally) sent to Gemini as a lightweight visual
// reference alongside a text description of the outfit.

export const OUTFITS = [
  {
    id: 'red-hoodie',
    name: 'Red Hoodie',
    thumbnail: '/outfits/red-hoodie.svg',
    description: 'a cozy bright red hoodie with a soft hood, sized to fit a dog\'s torso',
  },
  {
    id: 'yellow-raincoat',
    name: 'Yellow Raincoat',
    thumbnail: '/outfits/yellow-raincoat.svg',
    description: 'a glossy yellow rain jacket with a small hood and snap buttons, sized to fit a dog\'s torso',
  },
  {
    id: 'tuxedo',
    name: 'Formal Tuxedo',
    thumbnail: '/outfits/tuxedo.svg',
    description: 'a black-and-white formal tuxedo outfit with a bow tie, sized to fit a dog\'s torso',
  },
];

export function getOutfit(id) {
  return OUTFITS.find((outfit) => outfit.id === id);
}
