import type { StaticImageData } from "next/image";
import p01 from "@/assets/photos/zerkalo-01.jpg";
import p03 from "@/assets/photos/zerkalo-03.jpg";
import p04 from "@/assets/photos/zerkalo-04.jpg";
import p05 from "@/assets/photos/zerkalo-05.jpg";
import p07 from "@/assets/photos/zerkalo-07.jpg";
import p08 from "@/assets/photos/zerkalo-08.jpg";
import p09 from "@/assets/photos/zerkalo-09.jpg";
import p10 from "@/assets/photos/zerkalo-10.jpg";
import p11 from "@/assets/photos/zerkalo-11.jpg";
import p12 from "@/assets/photos/zerkalo-12.jpg";
import p13 from "@/assets/photos/zerkalo-13.jpg";
import p14 from "@/assets/photos/zerkalo-14.jpg";
import p15 from "@/assets/photos/zerkalo-15.jpg";
import p16 from "@/assets/photos/zerkalo-16.jpg";
import p17 from "@/assets/photos/zerkalo-17.jpg";
// Кадры из архива «Монтажей» (montage_media, Яндекс Диск «Монтажи M-Glass»): только
// «готово», без людей, документов и адресов в кадре; EXIF снят, полоса с маркой телефона
// обрезана. Подпись из Telegram на сайт не идёт — в ней адреса и телефоны клиентов.
import a15783 from "@/assets/photos/zerkalo-15783.jpg";
import a15229 from "@/assets/photos/zerkalo-15229.jpg";
import a14987 from "@/assets/photos/zerkalo-14987.jpg";
import a14989 from "@/assets/photos/zerkalo-14989.jpg";
import a14485 from "@/assets/photos/zerkalo-14485.jpg";
import a13164 from "@/assets/photos/zerkalo-13164.jpg";
import a12644 from "@/assets/photos/zerkalo-12644.jpg";
import a2029 from "@/assets/photos/zerkalo-2029.jpg";
import a3895 from "@/assets/photos/zerkalo-3895.jpg";
import a13242 from "@/assets/photos/zerkalo-13242.jpg";
import a10676 from "@/assets/photos/zerkalo-10676.jpg";
import a15531 from "@/assets/photos/zerkalo-15531.jpg";
import a14883 from "@/assets/photos/zerkalo-14883.jpg";
import a14835 from "@/assets/photos/zerkalo-14835.jpg";
import a13682 from "@/assets/photos/zerkalo-13682.jpg";
import a11864 from "@/assets/photos/zerkalo-11864.jpg";
import a11378 from "@/assets/photos/zerkalo-11378.jpg";
import a10847 from "@/assets/photos/zerkalo-10847.jpg";
import a10197 from "@/assets/photos/zerkalo-10197.jpg";
import a6942 from "@/assets/photos/zerkalo-6942.jpg";
import a6002 from "@/assets/photos/zerkalo-6002.jpg";
import a2788 from "@/assets/photos/zerkalo-2788.jpg";
import a10241 from "@/assets/photos/zerkalo-10241.jpg";
import a10673 from "@/assets/photos/zerkalo-10673.jpg";
import a15131 from "@/assets/photos/zerkalo-15131.jpg";
import a15119 from "@/assets/photos/zerkalo-15119.jpg";
import a7974 from "@/assets/photos/zerkalo-7974.jpg";
import a6313 from "@/assets/photos/zerkalo-6313.jpg";
import a7410 from "@/assets/photos/zerkalo-7410.jpg";
import a13898 from "@/assets/photos/zerkalo-13898.jpg";
import a6514 from "@/assets/photos/zerkalo-6514.jpg";
import a7130 from "@/assets/photos/zerkalo-7130.jpg";
import a10666 from "@/assets/photos/zerkalo-10666.jpg";
import a10670 from "@/assets/photos/zerkalo-10670.jpg";

// Фото работ из mglass-web (раздел «Наши работы») и из архива «Монтажей». Подписи — по
// тому, что видно на кадре; размер и адрес объекта неизвестны, поэтому их в подписях нет.
// Подсветку называем, только если она горит на кадре: у девяти кадров архива с меткой
// «без подсветки» нашёлся парный кадр того же зеркала со светом.
// month — когда кадр выложили в группу после монтажа (YYYY-MM).
export type Photo = { img: StaticImageData; alt: string; caption: string; month?: string };

export const PHOTOS = {
  wallTv: { img: p01, alt: "Зеркальная панель во всю высоту стены рядом с ТВ-зоной и вертикальной линией света", caption: "Зеркальная панель во всю высоту стены" },
  roundOrange: { img: p03, alt: "Два круглых зеркала в металлической раме оранжевого цвета над раковиной", caption: "Круглые зеркала в цветной металлической раме" },
  frontLight: { img: p04, alt: "Прямоугольное зеркало с фронтальной подсветкой через матовую полосу по периметру", caption: "Фронтальная подсветка через матовую полосу" },
  archAura: { img: p05, alt: "Арочные зеркала с подсветкой за зеркалом над двойной раковиной из камня", caption: "Арочные зеркала с подсветкой-аурой" },
  ringWall: { img: p07, alt: "Зеркальная стена от пола до потолка с кольцевой подсветкой у туалетного столика", caption: "Зеркало во всю стену с кольцевой подсветкой" },
  capsulesBlack: { img: p08, alt: "Два зеркала-капсулы в тонкой чёрной металлической раме над раковиной", caption: "Зеркала-капсулы в чёрной металлической раме" },
  roundAura: { img: p09, alt: "Круглое зеркало с подсветкой за зеркалом над подвесной тумбой в ванной", caption: "Круглое зеркало с подсветкой-аурой" },
  figureAura: { img: p10, alt: "Фигурное зеркало со скруглённым краем и мягкой подсветкой за зеркалом", caption: "Фигурное зеркало с подсветкой-аурой" },
  hallBlack: { img: p11, alt: "Зеркала в полный рост в тонкой чёрной раме по обе стороны от шкафа в прихожей", caption: "Зеркала в полный рост в прихожей" },
  ovalGold: { img: p12, alt: "Овальное зеркало в золотой металлической раме в ванной с мраморной плиткой", caption: "Овальное зеркало в золотой раме" },
  plainMarble: { img: p13, alt: "Прямоугольное зеркало без рамы и без подсветки на мраморной стене над раковиной", caption: "Зеркало без рамы и подсветки" },
  rectAura: { img: p14, alt: "Прямоугольное зеркало с тёплой подсветкой за зеркалом над тумбой в ванной", caption: "Прямоугольное зеркало с тёплой аурой" },
  rectAura2: { img: p15, alt: "Зеркало с тёплой подсветкой по контуру на стене из серого керамогранита", caption: "Аура тёплого света по контуру" },
  capsuleBlack: { img: p16, alt: "Вертикальное зеркало-капсула в тонкой чёрной раме в ванной у окна", caption: "Зеркало-капсула в чёрной раме" },
  roundPanel: { img: p17, alt: "Круглое зеркало, встроенное в декоративную стеновую панель", caption: "Круглое зеркало в стеновой панели" },

  dropAura: { img: a15783, month: "2026-09", alt: "Зеркало асимметричной формы капли с подсветкой по контуру над раковиной, рядом ниши в стене", caption: "Зеркало-капля с подсветкой по контуру" },
  wallAuraStone: { img: a15229, month: "2026-05", alt: "Широкое зеркало над каменной столешницей с двумя накладными раковинами в ванной с деревянными панелями", caption: "Широкое зеркало над каменной столешницей" },
  bigAuraPendants: { img: a14987, month: "2026-04", alt: "Большое прямоугольное зеркало с подсветкой-аурой над раковиной, перед ним подвесные светильники-шары", caption: "Большое зеркало с аурой и подвесными светильниками" },
  tallRoundedAura: { img: a14989, month: "2026-04", alt: "Высокое зеркало со скруглёнными углами и светящимся контуром на стене из деревянных панелей", caption: "Высокое зеркало со светящимся контуром" },
  archesAuraDouble: { img: a14485, month: "2025-12", alt: "Два арочных зеркала с подсветкой-аурой над двойной раковиной со столешницей из камня", caption: "Два арочных зеркала с аурой над двойной раковиной" },
  rectAuraMarble: { img: a13164, month: "2025-08", alt: "Прямоугольное зеркало с подсветкой-аурой на мраморной стене над раковиной", caption: "Прямоугольное зеркало с аурой на мраморе" },
  tallNicheAura: { img: a12644, month: "2025-06", alt: "Высокое зеркало с закруглённым низом и подсветкой в нише, отделанной деревом", caption: "Зеркало с закруглённым низом в деревянной нише" },
  blackFrameLight: { img: a2029, month: "2022-11", alt: "Широкое зеркало со скруглёнными углами в чёрной раме над мраморной столешницей", caption: "Широкое зеркало в чёрной раме над мраморной столешницей" },
  twoPieceFigure: { img: a3895, month: "2023-02", alt: "Фигурное зеркало из двух частей неправильной формы с подсветкой по контуру над тумбой в ванной", caption: "Фигурное зеркало из двух частей с подсветкой" },
  ovalFrameAuraHall: { img: a13242, month: "2025-08", alt: "Зеркало-капсула в тонкой чёрной раме с тёплой подсветкой над консолью у гардеробной", caption: "Зеркало-капсула с тёплой аурой у гардеробной" },
  wcStripLight: { img: a10676, month: "2024-12", alt: "Зеркальная полоса по периметру стен гостевого санузла с подсветкой сверху и снизу", caption: "Зеркальная полоса по периметру санузла" },
  roundRingFront: { img: a15531, month: "2026-07", alt: "Круглое зеркало с фронтальной подсветкой кольцом над туалетным столиком, по бокам подвесные светильники", caption: "Круглое зеркало с фронтальным кольцом света" },
  capsuleBlackAura: { img: a14883, month: "2026-03", alt: "Зеркало-капсула в чёрной раме с подсветкой на мраморной стене у душевой зоны", caption: "Зеркало-капсула в чёрной раме с аурой" },
  roundWarmDesk: { img: a14835, month: "2026-03", alt: "Круглое зеркало с тёплой подсветкой над деревянным туалетным столиком", caption: "Круглое зеркало с тёплым светом над столиком" },
  roundAuraWindow: { img: a13682, month: "2025-10", alt: "Круглое зеркало с тёплой подсветкой-аурой над подвесной консолью у окна", caption: "Круглое зеркало с аурой у окна" },
  roundAuraBlueTile: { img: a11864, month: "2025-03", alt: "Большое круглое зеркало с подсветкой-аурой в ванной, в отражении синяя плитка", caption: "Большое круглое зеркало с аурой" },
  roundAuraDark: { img: a11378, month: "2025-02", alt: "Круглое зеркало с подсветкой-аурой над раковиной-чашей на тёмной стене", caption: "Круглое зеркало с аурой на тёмной стене" },
  roundAuraBlueSink: { img: a10847, month: "2024-12", alt: "Круглое зеркало с подсветкой-аурой над голубой раковиной", caption: "Круглое зеркало с аурой над цветной раковиной" },
  roundAuraTeal: { img: a10197, month: "2024-11", alt: "Круглое зеркало с подсветкой-аурой на мраморной стене над раковиной", caption: "Круглое зеркало с аурой на мраморе" },
  roundAuraStone: { img: a6942, month: "2023-11", alt: "Круглое зеркало с тёплой подсветкой-аурой на стене из керамогранита в ванной", caption: "Круглое зеркало с тёплой аурой" },
  roundAuraWood: { img: a6002, month: "2023-08", alt: "Круглое зеркало с тёплой подсветкой-аурой на стене с деревянной отделкой над чёрной раковиной", caption: "Круглое зеркало с аурой на дереве" },
  roundAuraPanel: { img: a2788, month: "2022-12", alt: "Круглое зеркало с тёплой подсветкой-аурой на деревянной стеновой панели над столешницей", caption: "Круглое зеркало с аурой на стеновой панели" },
  roundGoldFrame: { img: a10241, month: "2024-11", alt: "Круглое зеркало в тонкой золотистой раме на мраморной стене ванной", caption: "Круглое зеркало в золотистой раме" },
  roundTerracotta: { img: a10673, month: "2024-12", alt: "Круглое зеркало без рамы на терракотовой стене, перед ним латунный подвесной светильник", caption: "Круглое зеркало на терракотовой стене" },
  archGoldFloor: { img: a15131, month: "2026-05", alt: "Арочное зеркало в полный рост в тонкой золотистой раме у белой стены с молдингами", caption: "Арочное зеркало в полный рост в золотистой раме" },
  ovalBlackCeiling: { img: a15119, month: "2026-05", alt: "Зеркало-капсула в чёрной раме на штанге от потолка над раковиной у окна", caption: "Зеркало-капсула на штанге от потолка" },
  goldFrameDouble: { img: a7974, month: "2024-04", alt: "Большое прямоугольное зеркало в золотой раме на мраморной стене над двойной раковиной", caption: "Большое зеркало в золотой раме" },
  roundedDarkFrame: { img: a6313, month: "2023-09", alt: "Зеркало со скруглёнными углами в тонкой тёмной раме на стене с деревом и мрамором", caption: "Зеркало со скруглёнными углами в тёмной раме" },
  figureTwoOvals: { img: a7410, month: "2024-01", alt: "Фигурное зеркало из двух соединённых частей без рамы над консолью в прихожей", caption: "Фигурное зеркало из двух частей" },
  facetFrameNiche: { img: a13898, month: "2025-10", alt: "Высокое зеркало с рамкой из зеркальных полос с фацетом в нише коридора", caption: "Зеркало с рамкой из полос с фацетом" },
  facetPanel: { img: a6514, month: "2023-10", alt: "Зеркальное панно из элементов с фацетом над столешницей между двумя бра", caption: "Панно из элементов с фацетом" },
  facetWall: { img: a7130, month: "2023-12", alt: "Зеркальная стена с фацетным рисунком в кухне-гостиной, в отражении остров и зона отдыха", caption: "Зеркальная стена с фацетным рисунком" },
  salonArches: { img: a10666, month: "2024-12", alt: "Два подвесных арочных зеркала с подсветкой над рабочим местом в салоне красоты", caption: "Подвесные арочные зеркала в салоне красоты" },
  salonArchSingle: { img: a10670, month: "2024-12", alt: "Арочные зеркала с подсветкой у рабочих мест мастеров в салоне красоты", caption: "Арочные зеркала у рабочих мест мастеров" },
} satisfies Record<string, Photo>;

export type PhotoKey = keyof typeof PHOTOS;

// Портфолио /raboty по разделам; каждый кадр — ровно в одном разделе.
export type WorkSection = {
  id: string;
  title: string;
  text: string;
  links: { href: string; label: string }[];
  photos: PhotoKey[];
};

export const WORK_SECTIONS: WorkSection[] = [
  {
    id: "s-podsvetkoj",
    title: "Зеркала с подсветкой",
    text: "Аура за полотном, фронтальный свет через матовую полосу и светящийся контур — на прямоугольниках, арках, каплях и фигурных зеркалах.",
    links: [{ href: "/zerkala-s-podsvetkoj", label: "Зеркала с подсветкой" }],
    photos: [
      "rectAura", "archesAuraDouble", "dropAura", "frontLight", "bigAuraPendants", "archAura",
      "twoPieceFigure", "rectAuraMarble", "figureAura", "tallNicheAura", "ovalFrameAuraHall",
      "tallRoundedAura", "capsuleBlackAura", "rectAura2", "ringWall",
    ],
  },
  {
    id: "kruglye",
    title: "Круглые зеркала",
    text: "Круг с тёплой и нейтральной аурой, с кольцом фронтального света, в тонкой раме и без неё — в ванной, спальне и прихожей.",
    links: [{ href: "/kruglye-zerkala", label: "Круглые зеркала" }],
    photos: [
      "roundAura", "roundAuraBlueTile", "roundRingFront", "roundAuraWood", "roundWarmDesk", "roundGoldFrame",
      "roundAuraWindow", "roundOrange", "roundAuraDark", "roundAuraPanel", "roundAuraBlueSink",
      "roundTerracotta", "roundAuraStone", "roundAuraTeal", "roundPanel",
    ],
  },
  {
    id: "v-rame",
    title: "В раме и без подсветки",
    text: "Тонкие металлические рамы — чёрные и золотистые, капсулы на штанге от потолка, зеркала в полный рост и полотна с полированной кромкой.",
    links: [
      { href: "/zerkala-v-rame", label: "Зеркала в раме" },
      { href: "/zerkala-bez-podsvetki", label: "Зеркала без подсветки" },
    ],
    photos: [
      "archGoldFloor", "capsulesBlack", "goldFrameDouble", "ovalBlackCeiling", "ovalGold", "roundedDarkFrame",
      "hallBlack", "blackFrameLight", "figureTwoOvals", "capsuleBlack", "plainMarble",
    ],
  },
  {
    id: "panno",
    title: "Во всю стену, панно и фацет",
    text: "Зеркальные стены от пола до потолка, панно из элементов с фацетом и зеркальная полоса по периметру комнаты.",
    links: [
      { href: "/zerkalnoe-panno", label: "Зеркальное панно" },
      { href: "/zerkala-s-facetom", label: "Зеркала с фацетом" },
    ],
    photos: ["facetWall", "facetPanel", "wallTv", "facetFrameNiche", "wcStripLight", "wallAuraStone"],
  },
  {
    id: "salony",
    title: "Для салонов красоты",
    text: "Подвесные арочные зеркала с подсветкой над рабочими местами мастеров.",
    links: [{ href: "/zerkala-dlya-salonov-krasoty", label: "Зеркала для салонов красоты" }],
    photos: ["salonArches", "salonArchSingle"],
  },
];
