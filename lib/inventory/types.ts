export type Contour = 'b2b' | 'b2c' | 'both'

export type Kind =
  | 'glass' | 'mirror' | 'hardware' | 'profile' | 'seal'
  | 'led' | 'consumable' | 'packaging' | 'other'

export type Unit = 'м2' | 'шт' | 'м.п.' | 'кг' | 'л' | 'компл'

export type MoveReason =
  | 'purchase' | 'return' | 'order' | 'production' | 'writeoff'
  | 'defect' | 'count' | 'init' | 'manual' | 'transfer'

export type RefTable = 'b2b_materials' | 'shower_catalog_items' | 'materials' | 'configurator_library'

export type DocType = 'purchase_order' | 'b2b_order' | 'order' | 'shop_request'

export type InventoryItem = {
  id:           number
  contour:      Contour
  kind:         Kind
  name:         string
  article:      string
  unit:         Unit
  pack_label:   string | null
  pack_size:    number
  ref_table:    RefTable | null
  ref_id:       string | null
  supplier_id:  string | null
  color:        string | null
  thickness:    number | null
  location:     string
  min_qty:      number
  target_qty:   number
  qty:          number
  qty_reserved: number
  avg_cost:     number
  bom_aliases:  string[]
  active:       boolean
  notes:        string
  created_at:   string
  updated_at:   string
}

export type InventoryMove = {
  id:              number
  item_id:         number
  qty:             number
  pack_qty:        number | null
  reason:          MoveReason
  unit_cost:       number
  doc_type:        DocType | null
  doc_id:          string | null
  note:            string
  created_by:      string | null
  created_by_name: string
  created_at:      string
}

// Строка плана списания: что документ хочет забрать со склада.
export type PlanRow = {
  item_id:   number | null   // null — позиции нет в реестре
  name:      string
  unit:      Unit | null
  qty:       number          // сколько нужно, в базовой единице
  available: number          // сколько есть сейчас
  matched:   'ref' | 'alias' | 'name' | 'none'
  source:    string          // откуда взято (позиция заказа / BOM)
}

export type ConsumePlan = {
  doc_type:  DocType
  doc_id:    string
  title:     string
  rows:      PlanRow[]
  already:   boolean         // по документу уже списывали
}

export type ReservationStatus = 'active' | 'released' | 'consumed'

export type InventoryReservation = {
  id:          number
  item_id:     number
  qty:         number
  status:      ReservationStatus
  doc_type:    'b2b_order' | 'order'
  doc_id:      string
  note:        string
  created_at:  string
  released_at: string | null
}

// Результат резервирования под заказ — контракт для launch-production.
export type ReservedRow = {
  item_id:   number
  name:      string
  unit:      Unit
  reserved:  number   // сколько зарезервировано (= min(потребность, доступное) не режем: резервируем всю потребность)
  available: number   // было доступно на момент резерва (qty − qty_reserved до этого резерва)
  source:    string   // как названо в заказе
}

export type ShortageRow = {
  item_id:  number | null   // null — позиции нет в номенклатуре
  name:     string
  unit:     Unit | null
  need:     number          // сколько требуется всего
  available: number         // сколько было доступно
  short:    number          // нехватка = need − available (что докупить)
  reason:   'not_in_stock' | 'insufficient'
  source:   string
}

export type ReserveResult = {
  reserved:        ReservedRow[]
  shortages:       ShortageRow[]
  alreadyReserved: boolean   // по заказу уже был активный резерв — ничего не создавали
}
