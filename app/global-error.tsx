'use client'

import { useEffect } from 'react'

// Ловит ошибки в корневом layout. Рендерит собственные html/body и inline-стили,
// т.к. глобальный CSS/Tailwind может не примениться, если layout упал.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { console.error(error) }, [error])
  return (
    <html lang="ru">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#f5f5f3' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ textAlign: 'center', maxWidth: 360 }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#111110', margin: '0 0 4px' }}>Что-то пошло не так</p>
            <p style={{ fontSize: 13, color: '#9a9a95', margin: '0 0 16px' }}>Приложение не загрузилось. Попробуйте обновить страницу.</p>
            <button onClick={() => location.reload()}
              style={{ padding: '8px 16px', background: '#111110', color: '#fff', fontSize: 13, fontWeight: 500, border: 0, borderRadius: 8, cursor: 'pointer' }}>
              Обновить
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
