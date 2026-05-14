'use client'

import Link from 'next/link'

export default function AccessDeniedPage() {
  return (
    <div className="min-h-screen bg-[#f8f8f5] flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 bg-[#f0f0ec] rounded-2xl flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-[#9b9b96]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-[22px] font-bold text-[#1a1a18] mb-2">Нет доступа</h1>
        <p className="text-[14px] text-[#6b6b66] mb-8">
          У вас нет прав для просмотра этой страницы.<br />
          Обратитесь к администратору, если считаете это ошибкой.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 bg-[#1a1a18] text-white text-[13px] font-semibold px-5 py-2.5 rounded-lg hover:bg-[#2a2a26] transition-colors"
        >
          На главную
        </Link>
      </div>
    </div>
  )
}
