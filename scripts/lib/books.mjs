// Google-книги владельца, из которых система забирает данные.
//
// Здесь, а не в каждом скрипте: книги живые, владелец их ведёт, и данные из них
// приходится догонять регулярно. Один список — одно место, где менять id, если
// книгу перезаведут.
//
// Обе открыты на чтение по ссылке — импорт ходит без ключей.

export const BOOKS = {
  // Продажи: помесячные вкладки «Июль 26», «Август 26» … одна строка = одна продажа.
  // Читается через htmlview: «оплачено» в книге отмечено цветом ячейки.
  sales: {
    id: '15FavFbEdA_G33k_4ExsuPYF4Xf_eezmGC64OTsTY9vw',
    title: 'Продажи Мгласс',
    url: 'https://docs.google.com/spreadsheets/d/15FavFbEdA_G33k_4ExsuPYF4Xf_eezmGC64OTsTY9vw/edit',
    tabs: { mglass: '1728905654', total: '403860949', production: '260127750' },
    script: 'scripts/import-sales-sheet.mjs',
  },
  // Управленческая: лист «Аналитика дохода» — дни по горизонтали, показатели и
  // менеджеры по вертикали (разговоры, замеры, оплаты, полученные деньги).
  management: {
    id: '1IVpJcexfVBg8W7GDpWDY6ROB3hVyGh01IT_sOQHBKjk',
    title: 'Управленческая таблица M-Glass',
    url: 'https://docs.google.com/spreadsheets/d/1IVpJcexfVBg8W7GDpWDY6ROB3hVyGh01IT_sOQHBKjk/edit',
    tabs: {
      income: '1902318311',        // Аналитика дохода
      stats: '580653919',          // Статистики
      byManager: '608190548',      // Аналитика по Менеджерам МГЛАСС
      promoPlan: '846495161',      // План по продв
      incomePlanIp: '1570779670',  // План по доходу ИП
    },
    script: 'scripts/import-manager-stats.mjs',
  },
}
