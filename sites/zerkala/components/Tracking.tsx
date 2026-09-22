"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { captureUtm } from "./LeadForm";

type Ym = (id: number, method: string, ...args: unknown[]) => void;

// Метрика подключается только с NEXT_PUBLIC_YM_ID; без него на сайте
// нет ни одного стороннего скрипта.
export function Tracking({ metrikaId }: { metrikaId: string }) {
  const pathname = usePathname();
  const prevUrl = useRef<string | null>(null);

  useEffect(() => {
    captureUtm();
  }, []);

  // Цели Метрики. Форма amoCRM живёт в iframe с forms.amocrm.ru, и об успешной
  // отправке сообщает только сообщением amoformsSuccessSubmit — других сигналов
  // у страницы нет. Телефон стоит в десятке мест, поэтому клик ловим делегированием.
  useEffect(() => {
    if (!metrikaId) return;
    const goal = (name: string) => (window as unknown as { ym?: Ym }).ym?.(Number(metrikaId), "reachGoal", name);
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('a[href^="tel:"]')) goal("phone_click");
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== "https://forms.amocrm.ru" || typeof e.data !== "string") return;
      try {
        if (JSON.parse(e.data)?.func === "amoformsSuccessSubmit") goal("lead_form");
      } catch {}
    };
    document.addEventListener("click", onClick);
    window.addEventListener("message", onMessage);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("message", onMessage);
    };
  }, [metrikaId]);

  // Первый просмотр отправляет init. Дальше Next.js меняет страницы без перезагрузки,
  // и Метрика о переходе не узнает, если не сообщить ей самим.
  useEffect(() => {
    if (!metrikaId) return;
    const url = window.location.href;
    if (prevUrl.current !== null && prevUrl.current !== url) {
      (window as unknown as { ym?: Ym }).ym?.(Number(metrikaId), "hit", url, {
        title: document.title,
        referer: prevUrl.current,
      });
    }
    prevUrl.current = url;
  }, [pathname, metrikaId]);

  if (!metrikaId) return null;
  const id = Number(metrikaId);
  return (
    <>
      {/* id не «ym»: элемент с этим id браузер отдаёт как window.ym, и заглушка Метрики не создаётся */}
      <Script id="yandex-metrika" strategy="afterInteractive">
        {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js?id=${id}","ym");ym(${id},"init",{ssr:true,webvisor:true,clickmap:true,referrer:document.referrer,url:location.href,accurateTrackBounce:true,trackLinks:true});`}
      </Script>
      <noscript>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`https://mc.yandex.ru/watch/${id}`} style={{ position: "absolute", left: "-9999px" }} alt="" />
        </div>
      </noscript>
    </>
  );
}
