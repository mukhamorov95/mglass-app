import { NextResponse } from 'next/server'
import { quickCalc, type CalcType, type CalcOptions } from '@/lib/quickCalc'

export async function POST(req: Request) {
  try {
    const { type, width, height, options = {} } = await req.json() as {
      type: CalcType
      width: number
      height: number
      options?: CalcOptions
    }

    if (!type || !width || !height) {
      return NextResponse.json({ error: 'type, width, height required' }, { status: 400 })
    }

    const result = await quickCalc(type, width, height, options)
    if (!result) {
      return NextResponse.json({ error: 'Calculation failed' }, { status: 500 })
    }

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
