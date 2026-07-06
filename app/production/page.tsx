import { redirect } from 'next/navigation'

// Старая страница-дубль. Живой производственный контур — /production-app.
export default function ProductionRedirect() {
  redirect('/production-app')
}
