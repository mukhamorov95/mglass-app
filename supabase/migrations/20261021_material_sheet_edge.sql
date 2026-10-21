-- Нерабочая кромка листа (владелец 21.10, заказ 05662): у матового листа вдоль обеих длинных
-- сторон по 10 мм без покрытия — рабочее поле 3210×2230. Калькулятор по нему решает, ляжет ли
-- рядом вторая крупная деталь или позиция берёт лист целиком (lib/b2b/wholeSheet.ts).
alter table b2b_materials add column if not exists sheet_edge_mm integer not null default 0
  check (sheet_edge_mm between 0 and 100);
update b2b_materials set sheet_edge_mm = 10
 where name in ('Сатинированное бесцветное', 'Сатин тонированный', 'CrystalVision Matelux') and sheet_edge_mm = 0;
