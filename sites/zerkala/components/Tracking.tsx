"use client";

import Script from "next/script";
import { useEffect } from "react";
import { captureUtm } from "./LeadForm";

// Метрика подключается только с NEXT_PUBLIC_YM_ID (этап С5); без него на сайте
// нет ни одного стороннего скрипта.
export function Tracking({ metrikaId }: { metrikaId: string }) {
  useEffect(() => {
    captureUtm();
  }, []);

  if (!metrikaId) return null;
  return (
    <Script id="ym" strategy="afterInteractive">
      {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(${Number(metrikaId)},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});`}
    </Script>
  );
}
