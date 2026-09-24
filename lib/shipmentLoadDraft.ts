// Отметки «Загружен», которые база не приняла (RLS молча отбирает 0 строк): живут
// на экране до отправки рейса и переживают перезагрузку списка, а не страницы.

export type LoadDraft = ReadonlyMap<string, boolean>

export const loadKey = (shipmentId: number, orderId: number) => `${shipmentId}:${orderId}`

export function applyLoadDraft(shipmentId: number, orderIds: number[], dbLoaded: number[], draft: LoadDraft): number[] {
  const loaded = new Set(dbLoaded)
  for (const orderId of orderIds) {
    const want = draft.get(loadKey(shipmentId, orderId))
    if (want === true) loaded.add(orderId)
    if (want === false) loaded.delete(orderId)
  }
  return orderIds.filter(id => loaded.has(id))
}

export function withLoadDraft(draft: LoadDraft, shipmentId: number, orderId: number, loaded: boolean | null): Map<string, boolean> {
  const next = new Map(draft)
  if (loaded === null) next.delete(loadKey(shipmentId, orderId))
  else next.set(loadKey(shipmentId, orderId), loaded)
  return next
}

export function dropShipmentDraft(draft: LoadDraft, shipmentId: number): Map<string, boolean> {
  return new Map([...draft].filter(([k]) => !k.startsWith(`${shipmentId}:`)))
}
