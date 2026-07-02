'use client'

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="px-4 py-2 bg-ink text-white text-sm font-semibold rounded-lg shadow-lg hover:bg-[#2a2a28]"
    >
      Печать / PDF
    </button>
  )
}
