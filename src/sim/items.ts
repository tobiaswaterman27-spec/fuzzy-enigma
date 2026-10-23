// Item catalogue. Prices are in cents.
export type ItemCategory = 'grocery' | 'household' | 'clothing' | 'supplies' | 'meal' | 'loot';

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  /** units per wholesale case */
  caseSize: number;
  /** wholesale price paid by a retailer */
  wholesale: number;
  /** price the wholesaler pays to import */
  importCost: number;
  /** recommended retail price */
  retail: number;
  /** satiety restored when eaten (0 = not edible) */
  satiety: number;
  energy: number;
  color: string; // presentation colour for packaging
  /** relative daily household demand weight */
  demand: number;
  /** must be cooked on a stove before it can be eaten */
  needsCooking?: boolean;
}

export const ITEMS: Record<string, ItemDef> = {
  bread: { id: 'bread', name: 'Bread Loaf', category: 'grocery', caseSize: 10, wholesale: 115, importCost: 80, retail: 240, satiety: 25, energy: 0, color: '#c98b4a', demand: 1.3 },
  milk: { id: 'milk', name: 'Milk 1L', category: 'grocery', caseSize: 12, wholesale: 85, importCost: 60, retail: 180, satiety: 10, energy: 2, color: '#e9eef2', demand: 1.2 },
  apples: { id: 'apples', name: 'Apples (bag)', category: 'grocery', caseSize: 10, wholesale: 140, importCost: 95, retail: 280, satiety: 15, energy: 2, color: '#c8352e', demand: 0.9 },
  soup: { id: 'soup', name: 'Canned Soup', category: 'grocery', caseSize: 12, wholesale: 75, importCost: 50, retail: 165, satiety: 30, energy: 0, color: '#d9762b', demand: 1.0 },
  pasta: { id: 'pasta', name: 'Pasta 500g', category: 'grocery', caseSize: 12, wholesale: 65, importCost: 45, retail: 145, satiety: 30, energy: 0, color: '#f2d06b', demand: 0.9, needsCooking: true },
  coffee: { id: 'coffee', name: 'Ground Coffee', category: 'grocery', caseSize: 8, wholesale: 290, importCost: 200, retail: 560, satiety: 0, energy: 15, color: '#5a3a22', demand: 0.5 },
  snacks: { id: 'snacks', name: 'Crisps', category: 'grocery', caseSize: 16, wholesale: 55, importCost: 35, retail: 135, satiety: 8, energy: 1, color: '#3b7dd8', demand: 1.1 },
  jewellery: { id: 'jewellery', name: 'Jewellery', category: 'loot', caseSize: 1, wholesale: 0, importCost: 0, retail: 0, satiety: 0, energy: 0, color: '#d4af37', demand: 0 },
  watch: { id: 'watch', name: 'Wristwatch', category: 'loot', caseSize: 1, wholesale: 0, importCost: 0, retail: 0, satiety: 0, energy: 0, color: '#9aa3a8', demand: 0 },
  laptop: { id: 'laptop', name: 'Laptop', category: 'loot', caseSize: 1, wholesale: 0, importCost: 0, retail: 0, satiety: 0, energy: 0, color: '#2b2f33', demand: 0 },
  phone_s: { id: 'phone_s', name: 'Mobile phone', category: 'loot', caseSize: 1, wholesale: 0, importCost: 0, retail: 0, satiety: 0, energy: 0, color: '#111111', demand: 0 },
  soap: { id: 'soap', name: 'Soap Bar', category: 'household', caseSize: 10, wholesale: 95, importCost: 60, retail: 210, satiety: 0, energy: 0, color: '#9ad0c2', demand: 0.5 },
  cafe_supplies: { id: 'cafe_supplies', name: 'Cafe Ingredients', category: 'supplies', caseSize: 20, wholesale: 210, importCost: 150, retail: 0, satiety: 0, energy: 0, color: '#bbbbbb', demand: 0 },
  meal: { id: 'meal', name: 'Cafe Meal', category: 'meal', caseSize: 1, wholesale: 0, importCost: 0, retail: 850, satiety: 55, energy: 5, color: '#ffffff', demand: 0 },
  outfit_casual: { id: 'outfit_casual', name: 'Casual Clothes', category: 'clothing', caseSize: 1, wholesale: 0, importCost: 0, retail: 0, satiety: 0, energy: 0, color: '#4a6fa5', demand: 0 },
  outfit_smart: { id: 'outfit_smart', name: 'Smart Clothes', category: 'clothing', caseSize: 1, wholesale: 0, importCost: 0, retail: 0, satiety: 0, energy: 0, color: '#2f3640', demand: 0 },
  uniform_market: { id: 'uniform_market', name: 'Corner Market Uniform', category: 'clothing', caseSize: 1, wholesale: 0, importCost: 0, retail: 0, satiety: 0, energy: 0, color: '#2e8b57', demand: 0 },
  uniform_wholesale: { id: 'uniform_wholesale', name: 'Hi-Vis Workwear', category: 'clothing', caseSize: 1, wholesale: 0, importCost: 0, retail: 0, satiety: 0, energy: 0, color: '#f4c20d', demand: 0 },
  uniform_cafe: { id: 'uniform_cafe', name: 'Cafe Apron', category: 'clothing', caseSize: 1, wholesale: 0, importCost: 0, retail: 0, satiety: 0, energy: 0, color: '#7b2d26', demand: 0 },
  uniform_site: { id: 'uniform_site', name: 'Site Gear (hi-vis, boots, hard hat)', category: 'clothing', caseSize: 1, wholesale: 0, importCost: 0, retail: 0, satiety: 0, energy: 0, color: '#f2a516', demand: 0 },
  bricks: { id: 'bricks', name: 'Bricks', category: 'supplies', caseSize: 16, wholesale: 60, importCost: 40, retail: 0, satiety: 0, energy: 0, color: '#a5583e', demand: 0 },
  uniform_police: { id: 'uniform_police', name: 'Police Uniform', category: 'clothing', caseSize: 1, wholesale: 0, importCost: 0, retail: 0, satiety: 0, energy: 0, color: '#1b2433', demand: 0 },
  cricket_bat: { id: 'cricket_bat', name: 'Cricket Bat', category: 'household', caseSize: 1, wholesale: 0, importCost: 0, retail: 3500, satiety: 0, energy: 0, color: '#d9b77a', demand: 0 },
  kitchen_knife: { id: 'kitchen_knife', name: 'Kitchen Knife', category: 'household', caseSize: 1, wholesale: 0, importCost: 0, retail: 1200, satiety: 0, energy: 0, color: '#b8bcc2', demand: 0 },
  fishing_rod: { id: 'fishing_rod', name: 'Fishing Rod', category: 'household', caseSize: 1, wholesale: 0, importCost: 0, retail: 2500, satiety: 0, energy: 0, color: '#2b4a3a', demand: 0 },
  bait: { id: 'bait', name: 'Bait', category: 'household', caseSize: 10, wholesale: 0, importCost: 0, retail: 25, satiety: 0, energy: 0, color: '#8a6a48', demand: 0 },
  fish_mackerel: { id: 'fish_mackerel', name: 'Fresh Mackerel', category: 'grocery', caseSize: 1, wholesale: 0, importCost: 0, retail: 300, satiety: 35, energy: 3, color: '#4a6a8a', demand: 0, needsCooking: true },
  fish_pollock: { id: 'fish_pollock', name: 'Fresh Pollock', category: 'grocery', caseSize: 1, wholesale: 0, importCost: 0, retail: 500, satiety: 45, energy: 3, color: '#6a7a5a', demand: 0, needsCooking: true },
  fish_bass: { id: 'fish_bass', name: 'Sea Bass', category: 'grocery', caseSize: 1, wholesale: 0, importCost: 0, retail: 1400, satiety: 55, energy: 5, color: '#9aa4ad', demand: 0, needsCooking: true },
  fish_cod: { id: 'fish_cod', name: 'Fresh Cod', category: 'grocery', caseSize: 1, wholesale: 0, importCost: 0, retail: 1100, satiety: 55, energy: 4, color: '#a89a7a', demand: 0, needsCooking: true },
  crab: { id: 'crab', name: 'Crab', category: 'grocery', caseSize: 1, wholesale: 0, importCost: 0, retail: 400, satiety: 30, energy: 2, color: '#c0392b', demand: 0, needsCooking: true },
  parcel: { id: 'parcel', name: 'Parcel', category: 'household', caseSize: 1, wholesale: 0, importCost: 0, retail: 0, satiety: 0, energy: 0, color: '#b08850', demand: 0 },
  mop: { id: 'mop', name: 'Mop & Bucket', category: 'supplies', caseSize: 1, wholesale: 0, importCost: 0, retail: 0, satiety: 0, energy: 0, color: '#2a7fd4', demand: 0 },
};

/** what wearing an outfit does - every effect is applied somewhere in the simulation */
export interface ClothingEffect {
  formality: number; // interview impression: +4 per point
  comfort: number; // fraction less energy used while off duty
  label: string;
}
export const CLOTHING: Record<string, ClothingEffect> = {
  outfit_casual: { formality: 0, comfort: 0.12, label: 'Comfortable: you tire 12% slower off duty' },
  outfit_smart: { formality: 2, comfort: 0, label: 'Smart: +8 interview impression' },
  uniform_market: { formality: 1, comfort: 0, label: 'Corner Market uniform: required on shift there' },
  uniform_wholesale: { formality: 0, comfort: 0, label: 'Hi-vis workwear: required in the warehouse' },
  uniform_cafe: { formality: 1, comfort: 0, label: 'Cafe apron' },
  uniform_site: { formality: 0, comfort: 0, label: 'Site gear: required on the building site' },
  uniform_police: { formality: 2, comfort: 0, label: 'Police uniform' },
};

export const PRODUCTS = ['bread', 'milk', 'apples', 'soup', 'pasta', 'coffee', 'snacks', 'soap'] as const;
export type ProductId = (typeof PRODUCTS)[number];

export const itemName = (id: string) => ITEMS[id]?.name ?? id;
export const isFood = (id: string) => (ITEMS[id]?.satiety ?? 0) > 0 || (ITEMS[id]?.energy ?? 0) > 0;
