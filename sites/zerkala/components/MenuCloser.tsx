"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Меню шапки сделано на <details> без JS, но шапка при переходе не
// перерисовывается — без этого меню остаётся открытым на новой странице.
export function MenuCloser() {
  const pathname = usePathname();
  useEffect(() => {
    document.querySelectorAll("header details[open]").forEach((d) => d.removeAttribute("open"));
  }, [pathname]);
  return null;
}
