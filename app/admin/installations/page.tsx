import { redirect } from 'next/navigation'

// Второй экран «Монтажи» на таблицах appointments/brigades — обе пусты (08.10).
// Живые монтажи — /installations (installations, installation_crews).
export default function AdminInstallationsRedirect() {
  redirect('/installations')
}
