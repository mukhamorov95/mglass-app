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

// Фото работ из mglass-web (раздел «Наши работы»). Подписи — по тому, что видно
// на кадре; размер и адрес объекта неизвестны, поэтому их в подписях нет.
export type Photo = { img: StaticImageData; alt: string; caption: string };

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
} satisfies Record<string, Photo>;

export type PhotoKey = keyof typeof PHOTOS;

export const GALLERY_ORDER: PhotoKey[] = [
  "rectAura", "roundAura", "archAura", "frontLight", "capsulesBlack", "hallBlack",
  "ovalGold", "figureAura", "wallTv", "ringWall", "roundOrange", "plainMarble",
  "capsuleBlack", "roundPanel", "rectAura2",
];
