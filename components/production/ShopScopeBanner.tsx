import Link from 'next/link'
import type { ShopScope } from '@/lib/production/shopScope'

// Плашка фильтра «только M-Glass»: цифры экрана под ней — только по розничным заказам,
// и об этом сказано словами, а не одним адресом страницы.
export default function ShopScopeBanner({ scope, allHref }: { scope: ShopScope; allHref: string }) {
  if (scope !== 'mglass') return null
  return (
    <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#111110] text-white px-3 py-1 text-[11px] font-semibold">
      Только заказы M-Glass
      <Link href={allHref} className="font-normal text-white/70 hover:text-white underline-offset-2 hover:underline">показать все</Link>
    </div>
  )
}
