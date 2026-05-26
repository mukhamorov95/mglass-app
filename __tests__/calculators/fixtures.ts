import type { Material, Service, FinancialSettings } from '@/lib/types'

export const mockMirrorMaterial: Material = {
  id: 1,
  name: 'Зеркало прозрачное',
  short_name: 'Зеркало',
  category: 'mirror',
  unit: 'м²',
  cost_price: 1200,
  sale_price: 2500,
  has_vat: false,
  vat_rate: 0,
  active: true,
  in_stock: true,
  comment: null,
  image_url: null,
  created_at: '2025-01-01',
  updated_at: '2025-01-01',
}

export const mockGlassMaterial: Material = {
  id: 2,
  name: 'Стекло прозрачное 4мм',
  short_name: 'Стекло 4мм',
  category: 'glass',
  unit: 'м²',
  cost_price: 800,
  sale_price: 1800,
  has_vat: false,
  vat_rate: 0,
  active: true,
  in_stock: true,
  comment: null,
  image_url: null,
  created_at: '2025-01-01',
  updated_at: '2025-01-01',
}

export const mockProfileMaterial: Material = {
  id: 3,
  name: 'Профиль 40×20',
  short_name: 'Профиль',
  category: 'profile',
  unit: 'пог.м',
  cost_price: 350,
  sale_price: 700,
  has_vat: false,
  vat_rate: 0,
  active: true,
  in_stock: true,
  comment: null,
  image_url: null,
  created_at: '2025-01-01',
  updated_at: '2025-01-01',
}

export const mockInstallService: Service = {
  id: 1,
  name: 'Монтаж',
  short_name: 'Монтаж',
  unit: 'шт',
  cost_price: 2000,
  sale_price: 5000,
  active: true,
  comment: null,
}

export const mockDeliveryService: Service = {
  id: 2,
  name: 'Доставка',
  short_name: 'Доставка',
  unit: 'шт',
  cost_price: 1000,
  sale_price: 2000,
  active: true,
  comment: null,
}

// Shower calculator ищет услуги по точному имени
export const mockShowerInstallService: Service = {
  id: 3,
  name: 'Монтаж душевой перегородки',
  short_name: 'Монтаж',
  unit: 'шт',
  cost_price: 3000,
  sale_price: 7000,
  active: true,
  comment: null,
}

export const mockShowerDeliveryService: Service = {
  id: 4,
  name: 'Доставка Москва',
  short_name: 'Доставка',
  unit: 'шт',
  cost_price: 1500,
  sale_price: 3000,
  active: true,
  comment: null,
}

export const mockFinancialSettings: FinancialSettings = {
  id: 1,
  tier: 'standard',
  product_type: null,
  tax_percent: 6,
  manager_percent: 5,
  realization_percent: 4,
  marketing_percent: 3,
  transport_percent: 2,
  operation_percent: 2,
  default_margin: 30,
  min_margin: 15,
  green_threshold: 25,
  yellow_threshold: 15,
  red_threshold: 5,
  blocked_below: 0,
  max_discount_percent: 20,
  sla_days_approved: 2,
  sla_days_in_work: 7,
  updated_at: '2025-01-01',
}
