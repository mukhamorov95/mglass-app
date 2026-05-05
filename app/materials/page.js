'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function MaterialsPage() {
  const [materials, setMaterials] = useState([])

  async function loadMaterials() {
    const { data, error } = await supabase
      .from('materials')
      .select('*')

    if (error) {
      console.log(error)
      return
    }

    setMaterials(data || [])
  }

  useEffect(() => {
    loadMaterials()
  }, [])

  return (
    <div style={{ padding: 20 }}>
      <h1>Материалы</h1>

      {materials.length === 0 && <p>Материалов пока нет</p>}

      {materials.map((item) => (
        <div key={item.id}>
          {item.name} — {item.cost_price} ₽
        </div>
      ))}
    </div>
  )
}