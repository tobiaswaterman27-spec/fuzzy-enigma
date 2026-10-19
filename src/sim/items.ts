// Item catalogue. Prices are in cents.
export type ItemCategory = 'grocery' | 'household' | 'clothing' | 'supplies' | 'meal';

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
};

export const PRODUCTS = ['bread', 'milk', 'apples', 'soup', 'pasta', 'coffee', 'snacks', 'soap'] as const;
export type ProductId = (typeof PRODUCTS)[number];

export const itemName = (id: string) => ITEMS[id]?.name ?? id;
export const isFood = (id: string) => (ITEMS[id]?.satiety ?? 0) > 0 || (ITEMS[id]?.energy ?? 0) > 0;
