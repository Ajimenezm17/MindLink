import './style.css'

// Evitar que scroll cambie el valor de inputs time/number cuando tienen foco
document.addEventListener('wheel', () => {
  const el = document.activeElement as HTMLInputElement | null
  if (el?.tagName === 'INPUT' && (el.type === 'time' || el.type === 'number' || el.type === 'range')) {
    el.blur()
  }
}, { passive: true })

type AuthMode = 'login' | 'register-paciente' | 'register-profesional'
type PortalType = 'usuario' | 'trabajador' | 'admin'

function resolveApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim()
  if (raw) return raw.replace(/\/$/, '')
  return 'http://localhost:8000/api'
}

const API_BASE_URL = resolveApiBaseUrl()

async function parseApiJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    if (text.trimStart().startsWith('<')) {
      throw new Error(
        'El servidor devolvió HTML en lugar de JSON. Comprueba que el backend está en marcha (puerto 8000) y recarga la página.',
      )
    }
    throw new Error('Respuesta del servidor no válida')
  }
}
const BRAND_LOGO_SRC = '/mindlink_logo.svg'
const BRAND_LOGO_SM = `<img src="${BRAND_LOGO_SRC}" alt="MindLink" class="h-9 w-auto" />`
const BRAND_LOGO_HERO = `<img src="${BRAND_LOGO_SRC}" alt="MindLink" class="h-12 w-auto" />`

/** Fecha local en YYYY-MM-DD (evita desfases UTC en inputs type=date). */
function formatLocalDateISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
const appElement = document.querySelector<HTMLDivElement>('#app')

if (!appElement) {
  throw new Error('No se encontro el contenedor principal')
}

const app = appElement
app.className = 'min-h-screen bg-[#F8F7FF] text-slate-700'

const roleLabel: Record<string, string> = {
  paciente: 'Panel del paciente',
  profesional: 'Panel del profesional',
  administrador: 'Panel del administrador',
}

function getRolePanelPath(rol: string): string {
  if (rol === 'paciente') return '/panel-paciente'
  if (rol === 'profesional') return '/panel-profesional'
  if (rol === 'administrador') return '/panel-admin'
  return '/panel'
}

function detectPortal(): PortalType {
  const path = window.location.pathname.toLowerCase()
  if (path.includes('mindlink-admin')) {
    return 'admin'
  }
  if (path.includes('mindlink-trabajador')) {
    return 'trabajador'
  }
  return 'usuario'
}

function ensureBasePath(): void {
  const currentPath = window.location.pathname.toLowerCase()
  if (currentPath === '/' || currentPath === '') {
    window.history.replaceState(null, '', '/mindlink')
  }
}

function getPortalByRole(rol: string): PortalType {
  if (rol === 'administrador') return 'admin'
  if (rol === 'profesional') return 'trabajador'
  return 'usuario'
}

function isAdminPanelRoute(): boolean {
  return window.location.pathname.toLowerCase().includes('/panel-admin')
}
function isPatientPanelRoute(): boolean {
  return window.location.pathname.toLowerCase().includes('/panel-paciente')
}
function isProfessionalPanelRoute(): boolean {
  return window.location.pathname.toLowerCase().includes('/panel-profesional')
}

function showTransitionOverlay(message = 'Redirigiendo...'): void {
  const existing = document.querySelector<HTMLElement>('#transition-overlay')
  if (existing) {
    const text = existing.querySelector<HTMLElement>('[data-message]')
    if (text) text.textContent = message
    existing.classList.remove('hidden')
    return
  }
  const overlay = document.createElement('div')
  overlay.id = 'transition-overlay'
  overlay.className =
    'fixed inset-0 z-[9999] flex items-center justify-center bg-[#F8F7FF]/90 backdrop-blur-[1px]'
  overlay.innerHTML = `
    <div class="flex min-w-[220px] flex-col items-center rounded-2xl bg-white px-6 py-5 shadow-[0_20px_50px_-25px_rgba(124,58,237,0.35)] ring-1 ring-violet-100">
      <div class="h-8 w-8 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600"></div>
      <p data-message class="mt-3 text-sm font-medium text-slate-700">${message}</p>
  </div>
  `
  document.body.appendChild(overlay)
}

function hideTransitionOverlay(): void {
  document.querySelector('#transition-overlay')?.classList.add('hidden')
}

async function renderAdminPanel(): Promise<void> {
  const token = localStorage.getItem('mindlink_token')
  if (!token) {
    window.location.href = '/mindlink-admin'
    return
  }

  app.innerHTML = `
    <main class="mx-auto min-h-screen w-full max-w-6xl px-4 py-8">
      <header class="mb-6 overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-slate-800 px-5 py-5 text-white shadow-md">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <div class="rounded-xl bg-white/15 p-2 ring-1 ring-white/25">${BRAND_LOGO_SM}</div>
  <div>
              <p class="text-xs uppercase tracking-wider text-violet-200">MindLink · Control</p>
              <h1 class="text-2xl font-semibold">Panel de administracion</h1>
              <p id="admin-welcome" class="text-sm text-violet-100">Vista general de la plataforma</p>
              <p id="admin-updated-at" class="mt-1 text-xs text-violet-200/90"></p>
  </div>
          </div>
          <button id="admin-logout" class="rounded-lg bg-white/15 px-3 py-2 text-sm font-medium text-white ring-1 ring-white/30 hover:bg-white/25">Cerrar sesion</button>
        </div>
      </header>

      <section class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <article class="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 border-l-4 border-violet-500">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Usuarios</p>
          <p id="kpi-total" class="mt-1 text-3xl font-bold text-slate-800">-</p>
          <p class="mt-1 text-xs text-slate-500"><span id="kpi-activos" class="font-medium text-emerald-600">-</span> activos · <span id="kpi-inactivos" class="font-medium text-rose-600">-</span> bloqueados</p>
        </article>
        <article class="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 border-l-4 border-sky-500">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Pacientes</p>
          <p id="kpi-pacientes" class="mt-1 text-3xl font-bold text-slate-800">-</p>
          <p class="text-xs text-slate-500">Registros emocionales: <span id="kpi-emociones" class="font-medium text-sky-700">-</span></p>
        </article>
        <article class="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 border-l-4 border-emerald-500">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Profesionales</p>
          <p id="kpi-profesionales" class="mt-1 text-3xl font-bold text-slate-800">-</p>
          <p class="text-xs text-slate-500">Agendas y citas activas</p>
        </article>
        <article class="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 border-l-4 border-amber-500">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Citas totales</p>
          <p id="kpi-citas" class="mt-1 text-3xl font-bold text-slate-800">-</p>
          <p class="text-xs text-slate-500">Proximos 7 dias: <span id="kpi-citas-prox" class="font-medium text-amber-700">-</span></p>
        </article>
</section>

      <section class="mb-6 grid gap-4 lg:grid-cols-3">
        <article class="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 lg:col-span-1">
          <h2 class="mb-3 text-sm font-semibold text-slate-800">Estado de citas</h2>
          <div class="space-y-2 text-sm">
            <div class="rounded-lg bg-amber-50 px-3 py-2">
              <div class="flex items-center justify-between"><span class="text-amber-800">Pendientes</span><span id="kpi-citas-pend" class="font-bold text-amber-900">-</span></div>
              <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-amber-100"><div id="bar-citas-pend" class="h-full rounded-full bg-amber-500 transition-all" style="width:0%"></div></div>
            </div>
            <div class="rounded-lg bg-emerald-50 px-3 py-2">
              <div class="flex items-center justify-between"><span class="text-emerald-800">Confirmadas</span><span id="kpi-citas-conf" class="font-bold text-emerald-900">-</span></div>
              <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-emerald-100"><div id="bar-citas-conf" class="h-full rounded-full bg-emerald-500 transition-all" style="width:0%"></div></div>
            </div>
            <div class="rounded-lg bg-rose-50 px-3 py-2">
              <div class="flex items-center justify-between"><span class="text-rose-800">Canceladas</span><span id="kpi-citas-canc" class="font-bold text-rose-900">-</span></div>
              <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-rose-100"><div id="bar-citas-canc" class="h-full rounded-full bg-rose-500 transition-all" style="width:0%"></div></div>
            </div>
          </div>
          <p class="mt-3 text-xs text-slate-500">Administradores en plataforma: <span id="kpi-admins" class="font-semibold text-slate-700">-</span></p>
        </article>
        <article class="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 lg:col-span-2">
          <h2 class="mb-3 text-sm font-semibold text-slate-800">Actividad reciente</h2>
          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <p class="mb-2 text-xs font-medium uppercase text-slate-500">Ultimas citas</p>
              <ul id="admin-recent-citas" class="space-y-2 text-sm text-slate-700"></ul>
            </div>
            <div>
              <p class="mb-2 text-xs font-medium uppercase text-slate-500">Ultimos registros</p>
              <ul id="admin-recent-users" class="space-y-2 text-sm text-slate-700"></ul>
            </div>
          </div>
        </article>
      </section>

      <section class="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-lg font-semibold text-slate-800">Gestion de usuarios</h2>
          <span class="text-xs text-slate-500">Buscar, filtrar y administrar cuentas</span>
  </div>
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <input id="admin-search" placeholder="Buscar por nombre, email o DNI" class="min-w-[220px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-300 focus:ring-1 focus:ring-violet-300"/>
          <select id="admin-role-filter" class="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-300 focus:ring-1 focus:ring-violet-300">
            <option value="">Todos los roles</option>
            <option value="paciente">Pacientes</option>
            <option value="profesional">Profesionales</option>
            <option value="administrador">Administradores</option>
          </select>
          <button id="admin-refresh" class="rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium text-white hover:bg-violet-600">Actualizar</button>
        </div>
        <p id="admin-error" class="mb-3 hidden rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"></p>
        <div class="overflow-auto">
          <table class="min-w-full text-left text-sm">
            <thead class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th class="px-2 py-2">ID</th>
                <th class="px-2 py-2">Nombre</th>
                <th class="px-2 py-2">Email</th>
                <th class="px-2 py-2">Rol</th>
                <th class="px-2 py-2">Estado</th>
                <th class="px-2 py-2">Telefono</th>
                <th class="px-2 py-2">DNI</th>
                <th class="px-2 py-2">Ciudad</th>
                <th class="px-2 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody id="admin-users-body"></tbody>
          </table>
  </div>
</section>

      <section id="admin-detail" class="mt-6 hidden rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 class="mb-3 text-lg font-semibold text-slate-800">Detalle de usuario</h2>
        <div id="admin-detail-content" class="text-sm text-slate-700"></div>
      </section>
    </main>
  `

  const logoutButton = document.querySelector<HTMLButtonElement>('#admin-logout')
  const errorBox = document.querySelector<HTMLParagraphElement>('#admin-error')
  const usersBody = document.querySelector<HTMLTableSectionElement>('#admin-users-body')
  const searchInput = document.querySelector<HTMLInputElement>('#admin-search')
  const roleFilter = document.querySelector<HTMLSelectElement>('#admin-role-filter')
  const refreshButton = document.querySelector<HTMLButtonElement>('#admin-refresh')
  const detailSection = document.querySelector<HTMLElement>('#admin-detail')
  const detailContent = document.querySelector<HTMLElement>('#admin-detail-content')

  const setError = (message: string) => {
    if (!errorBox) return
    if (!message) {
      errorBox.classList.add('hidden')
      errorBox.textContent = ''
      return
    }
    errorBox.textContent = message
    errorBox.classList.remove('hidden')
  }

  const setText = (id: string, value: string | number) => {
    const el = document.querySelector(`#${id}`)
    if (el) el.textContent = String(value)
  }

  const estadoCitaBadge = (estado: string) => {
    const e = String(estado || '').toLowerCase()
    if (e === 'confirmada' || e === 'completada') return 'bg-emerald-100 text-emerald-800'
    if (e === 'cancelada') return 'bg-rose-100 text-rose-800'
    return 'bg-amber-100 text-amber-800'
  }

  const fetchSummary = async () => {
    const response = await fetch(`${API_BASE_URL}/admin/resumen/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = await parseApiJson(response)
    if (!response.ok) throw new Error(body.detail || 'No se pudo cargar el resumen')
    setText('kpi-total', body.total_usuarios ?? 0)
    setText('kpi-pacientes', body.total_pacientes ?? 0)
    setText('kpi-profesionales', body.total_profesionales ?? 0)
    setText('kpi-admins', body.total_administradores ?? 0)
    setText('kpi-activos', body.usuarios_activos ?? 0)
    setText('kpi-inactivos', body.usuarios_inactivos ?? 0)
    setText('kpi-citas', body.total_citas ?? 0)
    setText('kpi-citas-prox', body.citas_proximas_7d ?? 0)
    setText('kpi-citas-pend', body.citas_pendientes ?? 0)
    setText('kpi-citas-conf', body.citas_confirmadas ?? 0)
    setText('kpi-citas-canc', body.citas_canceladas ?? 0)
    setText('kpi-emociones', body.registros_emocionales ?? 0)

    const totalCitas = Number(body.total_citas) || 0
    const setBar = (id: string, value: number) => {
      const bar = document.querySelector<HTMLElement>(`#${id}`)
      if (!bar) return
      const pct = totalCitas > 0 ? Math.min(100, Math.round((value / totalCitas) * 100)) : 0
      bar.style.width = `${pct}%`
    }
    setBar('bar-citas-pend', Number(body.citas_pendientes) || 0)
    setBar('bar-citas-conf', Number(body.citas_confirmadas) || 0)
    setBar('bar-citas-canc', Number(body.citas_canceladas) || 0)

    const updatedAt = document.querySelector<HTMLElement>('#admin-updated-at')
    if (updatedAt) {
      updatedAt.textContent = `Actualizado ${new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}`
    }

    const citasList = document.querySelector<HTMLElement>('#admin-recent-citas')
    if (citasList) {
      const citas = body.ultimas_citas || []
      citasList.innerHTML = citas.length
        ? citas
            .map((c: Record<string, string>) => {
              const fecha = c.fecha_hora
                ? new Date(c.fecha_hora).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
                : '-'
              return `<li class="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-medium text-slate-800">${fecha}</span>
                  <span class="rounded-full px-2 py-0.5 text-[10px] font-medium ${estadoCitaBadge(String(c.estado))}">${c.estado}</span>
                </div>
                <p class="text-xs text-slate-500">${c.paciente_nombre} → ${c.profesional_nombre}</p>
              </li>`
            })
            .join('')
        : '<li class="text-xs text-slate-500">Sin citas registradas</li>'
    }

    const usersList = document.querySelector<HTMLElement>('#admin-recent-users')
    if (usersList) {
      const users = body.ultimos_usuarios || []
      usersList.innerHTML = users.length
        ? users
            .map((u: Record<string, string | boolean>) => {
              const fecha = u.fecha_registro
                ? new Date(String(u.fecha_registro)).toLocaleDateString('es-ES')
                : '-'
              return `<li class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
                <div>
                  <p class="font-medium text-slate-800">${u.nombre}</p>
                  <p class="text-xs text-slate-500">${u.email} · ${u.rol}</p>
                </div>
                <span class="text-[10px] ${u.activo ? 'text-emerald-600' : 'text-rose-600'}">${u.activo ? 'activo' : 'bloqueado'}</span>
              </li>`
            })
            .join('')
        : '<li class="text-xs text-slate-500">Sin usuarios recientes</li>'
    }
  }

  const fetchUsers = async () => {
    const params = new URLSearchParams()
    if (searchInput?.value.trim()) params.set('q', searchInput.value.trim())
    if (roleFilter?.value) params.set('rol', roleFilter.value)
    const url = new URL(`${API_BASE_URL}/admin/usuarios/`)
    params.forEach((value, key) => url.searchParams.set(key, value))
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = await parseApiJson(response)
    if (!response.ok) throw new Error(body.detail || 'No se pudo cargar usuarios')
    if (!usersBody) return
    usersBody.innerHTML = (body.usuarios || [])
      .map(
        (u: Record<string, string | number | boolean | null>) => `
          <tr class="border-b border-slate-100 transition hover:bg-violet-50/40">
            <td class="px-2 py-2">${u.id ?? '-'}</td>
            <td class="px-2 py-2">${u.nombre ?? '-'}</td>
            <td class="px-2 py-2">${u.email ?? '-'}</td>
            <td class="px-2 py-2">
              <select data-action="rol" data-user-id="${u.id}" class="rounded border border-slate-200 px-2 py-1">
                <option value="paciente" ${u.rol === 'paciente' ? 'selected' : ''}>paciente</option>
                <option value="profesional" ${u.rol === 'profesional' ? 'selected' : ''}>profesional</option>
                <option value="administrador" ${u.rol === 'administrador' ? 'selected' : ''}>administrador</option>
              </select>
            </td>
            <td class="px-2 py-2">
              <span class="${u.activo ? 'text-green-700' : 'text-red-700'}">${u.activo ? 'activo' : 'bloqueado'}</span>
            </td>
            <td class="px-2 py-2">${u.telefono ?? '-'}</td>
            <td class="px-2 py-2">${u.dni ?? '-'}</td>
            <td class="px-2 py-2">${u.ciudad_residencia ?? '-'}</td>
            <td class="px-2 py-2">
              <div class="flex gap-1">
                <button data-action="detalle" data-user-id="${u.id}" class="rounded bg-slate-100 px-2 py-1 text-xs">Detalle</button>
                <button data-action="estado" data-user-id="${u.id}" data-activo="${u.activo}" class="rounded ${u.activo ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'} px-2 py-1 text-xs">${u.activo ? 'Bloquear' : 'Activar'}</button>
  </div>
            </td>
          </tr>
        `,
      )
      .join('')

    usersBody.querySelectorAll<HTMLSelectElement>('select[data-action="rol"]').forEach((select) => {
      select.addEventListener('change', async () => {
        const userId = select.dataset.userId
        if (!userId) return
        try {
          setError('')
          const response = await fetch(`${API_BASE_URL}/admin/usuarios/${userId}/rol/`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ rol: select.value }),
          })
          const resBody = await response.json()
          if (!response.ok) throw new Error(resBody.detail || 'No se pudo actualizar el rol')
          await fetchUsers()
          await fetchSummary()
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Error al actualizar rol')
        }
      })
    })

    usersBody.querySelectorAll<HTMLButtonElement>('button[data-action="estado"]').forEach((button) => {
      button.addEventListener('click', async () => {
        const userId = button.dataset.userId
        const activo = button.dataset.activo === 'true'
        if (!userId) return
        try {
          setError('')
          const response = await fetch(`${API_BASE_URL}/admin/usuarios/${userId}/estado/`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ activo: !activo }),
          })
          const resBody = await response.json()
          if (!response.ok) throw new Error(resBody.detail || 'No se pudo actualizar el estado')
          await fetchUsers()
          await fetchSummary()
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Error al cambiar estado')
        }
      })
    })

    usersBody.querySelectorAll<HTMLButtonElement>('button[data-action="detalle"]').forEach((button) => {
      button.addEventListener('click', async () => {
        const userId = button.dataset.userId
        if (!userId || !detailSection || !detailContent) return
        try {
          setError('')
          const response = await fetch(`${API_BASE_URL}/admin/usuarios/${userId}/`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          const resBody = await response.json()
          if (!response.ok) throw new Error(resBody.detail || 'No se pudo cargar detalle')
          const u = resBody.usuario || {}
          detailSection.classList.remove('hidden')
          const adminPerms = u.administrador
            ? `
              <div class="mt-3 rounded border border-slate-200 p-3">
                <p class="mb-2 font-medium">Permisos de administrador</p>
                <label class="mr-3"><input id="perm-usuarios" type="checkbox" ${u.administrador.perm_usuarios ? 'checked' : ''}/> Usuarios</label>
                <label class="mr-3"><input id="perm-cuestionarios" type="checkbox" ${u.administrador.perm_cuestionarios ? 'checked' : ''}/> Cuestionarios</label>
                <label><input id="perm-citas" type="checkbox" ${u.administrador.perm_citas ? 'checked' : ''}/> Citas</label>
                <button id="save-perms" class="ml-3 rounded bg-violet-500 px-2 py-1 text-xs text-white">Guardar permisos</button>
  </div>
            `
            : ''
          detailContent.innerHTML = `
            <p><strong>ID:</strong> ${u.id ?? '-'}</p>
            <p><strong>Nombre:</strong> ${u.nombre ?? '-'}</p>
            <p><strong>Email:</strong> ${u.email ?? '-'}</p>
            <p><strong>Rol:</strong> ${u.rol ?? '-'}</p>
            <p><strong>Telefono:</strong> ${u.telefono ?? '-'}</p>
            <p><strong>DNI:</strong> ${u.dni ?? '-'}</p>
            <p><strong>Ciudad:</strong> ${u.ciudad_residencia ?? '-'}</p>
            <p><strong>Activo:</strong> ${u.activo ? 'si' : 'no'}</p>
            ${adminPerms}
          `
          const savePerms = detailContent.querySelector<HTMLButtonElement>('#save-perms')
          savePerms?.addEventListener('click', async () => {
            const permUsuarios = !!detailContent.querySelector<HTMLInputElement>('#perm-usuarios')?.checked
            const permCuestionarios = !!detailContent.querySelector<HTMLInputElement>('#perm-cuestionarios')?.checked
            const permCitas = !!detailContent.querySelector<HTMLInputElement>('#perm-citas')?.checked
            try {
              const permResponse = await fetch(`${API_BASE_URL}/admin/usuarios/${userId}/permisos/`, {
                method: 'PATCH',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  perm_usuarios: permUsuarios,
                  perm_cuestionarios: permCuestionarios,
                  perm_citas: permCitas,
                }),
              })
              const permBody = await permResponse.json()
              if (!permResponse.ok) throw new Error(permBody.detail || 'No se pudieron guardar permisos')
              setError('')
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Error al guardar permisos')
            }
          })
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Error al cargar detalle')
        }
      })
    })
  }

  const loadPanel = async () => {
    try {
      setError('')
      const meResponse = await fetch(`${API_BASE_URL}/auth/me/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const meBody = await meResponse.json()
      if (!meResponse.ok || meBody.rol !== 'administrador') {
        localStorage.removeItem('mindlink_token')
        localStorage.removeItem('mindlink_user')
        window.location.href = '/mindlink-admin'
        return
      }
      const welcome = document.querySelector<HTMLElement>('#admin-welcome')
      if (welcome && meBody.nombre) {
        welcome.textContent = `Hola, ${meBody.nombre} — resumen de la plataforma`
      }
      await fetchSummary()
      await fetchUsers()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo cargar el panel')
    }
  }

  refreshButton?.addEventListener('click', loadPanel)
  searchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      loadPanel()
    }
  })
  roleFilter?.addEventListener('change', loadPanel)
  logoutButton?.addEventListener('click', () => {
    localStorage.removeItem('mindlink_token')
    localStorage.removeItem('mindlink_user')
    window.location.href = '/mindlink-admin'
  })

  await loadPanel()
}

async function renderPatientPanel(): Promise<void> {
  const token = localStorage.getItem('mindlink_token')
  if (!token) {
    window.location.href = '/mindlink'
    return
  }
  app.innerHTML = `
    <main class="mx-auto min-h-screen w-full max-w-6xl px-4 py-8">
      <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          ${BRAND_LOGO_SM}
          <h1 class="text-2xl font-semibold text-slate-800">Panel del paciente</h1>
        </div>
        <button id="logout" class="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-300">Cerrar sesion</button>
      </header>
      <section class="mb-4 flex flex-wrap gap-2">
        <button id="tab-paciente-citas" class="rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white">Citas</button>
        <button id="tab-paciente-bienestar" class="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300">Bienestar</button>
        <button id="tab-paciente-asistente" class="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300">Asistente</button>
        <button id="tab-paciente-chats" class="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300">Chats</button>
</section>
      <section id="patient-view-citas" class="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <article class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 class="mb-4 text-lg font-semibold text-slate-800">Reservar nueva cita</h2>
          <div class="mb-3 flex flex-wrap gap-2">
            <button id="scope-my-psych" class="rounded-lg bg-violet-500 px-3 py-2 text-xs font-medium text-white">Citas con mi psicologo</button>
            <button id="scope-new-psych" class="rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-300">Citas con nuevos psicologos</button>
          </div>
          <div class="space-y-3">
            <div id="new-psych-list-wrap">
              <p id="psych-picker-label" class="mb-1 text-sm font-medium text-slate-700">Selecciona psicologo</p>
              <div id="new-psych-list" class="grid gap-2"></div>
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Filtrar por especialidad</label>
              <input id="specialty-filter" type="text" placeholder="Ej. ansiedad, pareja, infantil..." class="w-full rounded-lg border border-slate-200 px-3 py-2"/>
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Dia de consulta</label>
              <input id="fecha-cita-date" type="date" class="w-full rounded-lg border border-slate-200 px-3 py-2"/>
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Filtrar por duracion</label>
              <select id="duracion-filter" class="w-full rounded-lg border border-slate-200 px-3 py-2">
                <option value="">Todas</option>
                <option value="45">45 min</option>
                <option value="50">50 min</option>
                <option value="60">60 min</option>
                <option value="90">90 min</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Precio maximo (€)</label>
              <input id="price-filter" type="number" min="0" step="1" placeholder="Sin limite" class="w-full rounded-lg border border-slate-200 px-3 py-2"/>
            </div>
            <button id="cargar-slots" class="w-full rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium text-white hover:bg-violet-600">Buscar horarios disponibles</button>
            <div>
              <p class="mb-2 text-sm font-medium text-slate-700">Horarios disponibles</p>
              <div id="slots-box" class="grid gap-2 sm:grid-cols-2"></div>
            </div>
            <div>
              <p class="mb-2 text-sm font-medium text-slate-700">Proximos horarios sugeridos</p>
              <div id="next-slots-box" class="grid gap-2 sm:grid-cols-2"></div>
            </div>
          </div>
          <p id="patient-msg" class="mt-3 hidden rounded-lg border px-3 py-2 text-sm"></p>
        </article>
        <article class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 class="mb-4 text-lg font-semibold text-slate-800">Mis citas</h2>
          <div id="patient-citas" class="space-y-2 text-sm"></div>
        </article>
      </section>
      <section id="patient-view-bienestar" class="mt-6 hidden">
        <!-- Calendario emocional -->
        <article class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-800">Tu calendario emocional</h2>
            <div class="flex items-center gap-2">
              <button id="mood-cal-prev" class="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">&larr;</button>
              <span id="mood-cal-title" class="min-w-[140px] text-center text-sm font-medium text-slate-700"></span>
              <button id="mood-cal-next" class="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">&rarr;</button>
            </div>
          </div>
          <div class="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
            <span>Lun</span><span>Mar</span><span>Mie</span><span>Jue</span><span>Vie</span><span>Sab</span><span>Dom</span>
          </div>
          <div id="mood-cal-grid" class="mt-1 grid grid-cols-7 gap-1"></div>
          <div id="mood-cal-detail" class="mt-3 hidden rounded-lg border border-violet-100 bg-violet-50/40 p-3 text-sm text-slate-700"></div>
          <div class="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span class="flex items-center gap-1"><span class="inline-block h-3 w-3 rounded bg-red-300"></span>1-2</span>
            <span class="flex items-center gap-1"><span class="inline-block h-3 w-3 rounded bg-orange-300"></span>3-4</span>
            <span class="flex items-center gap-1"><span class="inline-block h-3 w-3 rounded bg-yellow-300"></span>5-6</span>
            <span class="flex items-center gap-1"><span class="inline-block h-3 w-3 rounded bg-lime-300"></span>7-8</span>
            <span class="flex items-center gap-1"><span class="inline-block h-3 w-3 rounded bg-emerald-400"></span>9-10</span>
          </div>
        </article>

        <!-- Registro diario -->
        <article class="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 class="mb-1 text-lg font-semibold text-slate-800">Registro diario</h2>
          <p class="mb-4 text-xs text-slate-500">Valora tu estado de animo y escribe tus notas del dia</p>

          <div class="mb-5">
            <label class="mb-2 block text-sm font-medium text-slate-700">Estado de animo</label>
            <div class="flex items-center gap-3">
              <span class="text-xs text-slate-400 w-12">Muy mal</span>
              <input id="mood-intensity-range" type="range" min="1" max="10" value="5" class="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-gradient-to-r from-red-300 via-yellow-200 to-emerald-400 accent-violet-600"/>
              <span class="text-xs text-slate-400 w-12 text-right">Muy bien</span>
            </div>
            <p class="mt-1 text-center text-sm font-semibold text-violet-600"><span id="mood-intensity-label">5</span> / 10</p>
          </div>

          <div class="mb-4">
            <label for="mood-nota" class="mb-1 block text-sm font-medium text-slate-700">Notas del dia</label>
            <textarea id="mood-nota" rows="4" placeholder="¿Que ha pasado hoy? ¿Como te has sentido? Escribe lo que quieras..." class="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-violet-300 focus:outline-none focus:ring-1 focus:ring-violet-300"></textarea>
          </div>

          <button id="save-emotion" class="w-full rounded-xl bg-violet-500 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-600 disabled:opacity-50">Guardar registro del dia</button>
        </article>

        <!-- Perfil y cuestionario -->
        <article class="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 class="mb-3 text-base font-semibold text-slate-800">Mi perfil</h2>
          <div class="grid gap-2 sm:grid-cols-3">
            <input id="profile-nombre" type="text" placeholder="Nombre" class="rounded-lg border border-slate-200 px-3 py-2 text-sm"/>
            <input id="profile-telefono" type="text" placeholder="Telefono" class="rounded-lg border border-slate-200 px-3 py-2 text-sm"/>
            <input id="profile-ciudad" type="text" placeholder="Ciudad" class="rounded-lg border border-slate-200 px-3 py-2 text-sm"/>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <button id="save-profile" class="rounded-lg bg-violet-500 px-3 py-2 text-xs font-medium text-white">Guardar perfil</button>
            <button id="run-questionnaire" class="rounded-lg bg-indigo-500 px-3 py-2 text-xs font-medium text-white">Completar cuestionario inicial</button>
          </div>
          <p id="questionnaire-state" class="mt-2 rounded border border-indigo-100 bg-indigo-50 px-2 py-1 text-xs text-indigo-700">Cuestionario pendiente</p>
        </article>
      </section>
      <section id="patient-view-asistente" class="mt-6 hidden">
        <article class="rounded-2xl bg-white p-0 shadow-sm ring-1 ring-slate-200">
          <div class="flex min-h-[560px] flex-col">
            <div class="border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-violet-50 px-5 py-4">
              <h2 class="text-lg font-semibold text-slate-800">Asistente de bienestar</h2>
              <p class="mt-1 text-xs text-slate-600">Apoyo emocional en castellano de Espana. No sustituye a tu psicologo.</p>
              <p class="mt-1 text-xs text-rose-700">En emergencia o crisis: 024, 016 o 112.</p>
              <p id="wellbeing-bot-ia-banner" class="mt-2 hidden rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"></p>
            </div>
            <div id="wellbeing-bot-thread" class="flex-1 overflow-auto bg-slate-50 p-4 text-sm text-slate-700"></div>
            <div class="border-t border-slate-200 p-4">
              <textarea id="wellbeing-bot-input" rows="3" placeholder="Cuentame como te sientes hoy..." class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"></textarea>
              <p id="wellbeing-bot-msg" class="mt-2 hidden rounded-lg border px-2 py-1 text-xs"></p>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <button id="wellbeing-bot-send" type="button" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Enviar</button>
                <button id="wellbeing-bot-clear" type="button" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">Limpiar chat</button>
              </div>
              <p id="wellbeing-bot-source" class="mt-2 text-[10px] text-slate-400"></p>
            </div>
          </div>
        </article>
      </section>
      <section id="patient-view-chats" class="mt-6 hidden">
        <article class="rounded-2xl bg-white p-0 shadow-sm ring-1 ring-slate-200">
          <div class="grid min-h-[520px] md:grid-cols-[1fr_300px]">
            <div class="flex flex-col border-b border-slate-200 md:border-b-0 md:border-r">
              <div class="border-b border-slate-200 px-4 py-3">
                <p class="text-xs uppercase tracking-wide text-slate-500">Conversacion activa</p>
                <p id="patient-chat-active-name" class="text-sm font-semibold text-slate-800">Sin chat seleccionado</p>
              </div>
              <div id="chat-thread" class="h-[380px] overflow-auto bg-slate-50 p-3 text-sm text-slate-700"></div>
              <div class="border-t border-slate-200 p-3">
                <textarea id="chat-message" rows="2" placeholder="Escribe un mensaje..." class="w-full rounded border border-slate-200 px-3 py-2 text-sm"></textarea>
                <p id="chat-patient-msg" class="mt-2 hidden rounded-lg border px-2 py-1 text-xs"></p>
                <div class="mt-2 flex gap-2">
                  <button id="send-chat-message" class="rounded bg-emerald-600 px-3 py-2 text-xs text-white disabled:opacity-50">Enviar mensaje</button>
                </div>
              </div>
            </div>
            <aside class="p-3">
              <p class="mb-2 text-sm font-semibold text-slate-800">Contactos recientes</p>
              <div id="chat-conversation-list" class="space-y-1"></div>
            </aside>
          </div>
        </article>
      </section>
    </main>
  `
  const msg = document.querySelector<HTMLParagraphElement>('#patient-msg')
  const showMsg = (text: string, ok: boolean) => {
    if (!msg) return
    msg.textContent = text
    msg.className = `mt-3 rounded-lg border px-3 py-2 text-sm ${ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`
  }
  const tabClassActive = 'rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white'
  const tabClassInactive = 'rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300'
  const showPatientSection = (section: 'citas' | 'bienestar' | 'asistente' | 'chats') => {
    const citasView = document.querySelector<HTMLElement>('#patient-view-citas')
    const bienestarView = document.querySelector<HTMLElement>('#patient-view-bienestar')
    const asistenteView = document.querySelector<HTMLElement>('#patient-view-asistente')
    const chatsView = document.querySelector<HTMLElement>('#patient-view-chats')
    const citasTab = document.querySelector<HTMLButtonElement>('#tab-paciente-citas')
    const bienestarTab = document.querySelector<HTMLButtonElement>('#tab-paciente-bienestar')
    const asistenteTab = document.querySelector<HTMLButtonElement>('#tab-paciente-asistente')
    const chatsTab = document.querySelector<HTMLButtonElement>('#tab-paciente-chats')
    if (!citasView || !bienestarView || !asistenteView || !chatsView || !citasTab || !bienestarTab || !asistenteTab || !chatsTab) return
    citasView.classList.toggle('hidden', section !== 'citas')
    bienestarView.classList.toggle('hidden', section !== 'bienestar')
    asistenteView.classList.toggle('hidden', section !== 'asistente')
    chatsView.classList.toggle('hidden', section !== 'chats')
    citasTab.className = section === 'citas' ? tabClassActive : tabClassInactive
    bienestarTab.className = section === 'bienestar' ? tabClassActive : tabClassInactive
    asistenteTab.className = section === 'asistente' ? tabClassActive : tabClassInactive
    chatsTab.className = section === 'chats' ? tabClassActive : tabClassInactive
    if (section === 'asistente') {
      document.querySelector<HTMLTextAreaElement>('#wellbeing-bot-input')?.focus()
      void refreshWellbeingBotStatus()
    }
  }
  const todayMidnight = () => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())

  let currentPatientId = 0
  let currentConversationId = 0
  let patientConversations: Array<Record<string, string | number>> = []
  let professionalScope: 'my' | 'new' = 'my'
  let allProfessionals: Array<Record<string, string | number>> = []
  let myProfessionalIds = new Set<number>()
  let selectedProfessionalId = 0
  const getSpecialtyFilter = () => (document.querySelector<HTMLInputElement>('#specialty-filter')?.value || '').trim().toLowerCase()
  const getBookingFilteredProfessionals = () => {
    let filtered = allProfessionals
    if (professionalScope === 'my') {
      filtered = filtered.filter((p) => myProfessionalIds.has(Number(p.id)))
      if (selectedProfessionalId) {
        filtered = filtered.filter((p) => Number(p.id) === selectedProfessionalId)
      }
    } else {
      filtered = filtered.filter((p) => !myProfessionalIds.has(Number(p.id)))
    }
    const specialtyRaw = getSpecialtyFilter()
    if (specialtyRaw) {
      filtered = filtered.filter((p) => String(p.especialidad || '').toLowerCase().includes(specialtyRaw))
    }
    return filtered
  }
  const applyProfessionalScopeStyles = () => {
    const myBtn = document.querySelector<HTMLButtonElement>('#scope-my-psych')
    const newBtn = document.querySelector<HTMLButtonElement>('#scope-new-psych')
    if (myBtn) {
      myBtn.className =
        professionalScope === 'my'
          ? 'rounded-lg bg-violet-500 px-3 py-2 text-xs font-medium text-white'
          : 'rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-300'
    }
    if (newBtn) {
      newBtn.className =
        professionalScope === 'new'
          ? 'rounded-lg bg-violet-500 px-3 py-2 text-xs font-medium text-white'
          : 'rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-300'
    }
    const listWrap = document.querySelector<HTMLElement>('#new-psych-list-wrap')
    const pickerLabel = document.querySelector<HTMLElement>('#psych-picker-label')
    if (listWrap) listWrap.classList.toggle('hidden', professionalScope !== 'my')
    if (pickerLabel) pickerLabel.textContent = 'Selecciona psicologo'
  }
  const syncProfessionalFromActiveChat = () => {
    if (!currentConversationId) return
    const conv = patientConversations.find((c) => Number(c.id) === currentConversationId)
    if (conv?.profesional_id) selectedProfessionalId = Number(conv.profesional_id)
  }
  const refillProfessionalSelect = () => {
    const list = document.querySelector<HTMLElement>('#new-psych-list')
    if (!list) return
    if (professionalScope !== 'my') {
      list.innerHTML = ''
      if (!currentConversationId) selectedProfessionalId = 0
      else syncProfessionalFromActiveChat()
      return
    }
    const filtered = getBookingFilteredProfessionals()
    if (!filtered.length) {
      list.innerHTML = ''
      if (!currentConversationId) selectedProfessionalId = 0
      else syncProfessionalFromActiveChat()
      return
    }
    if (!selectedProfessionalId || !filtered.some((p) => Number(p.id) === selectedProfessionalId)) {
      selectedProfessionalId = Number(filtered[0].id || 0)
    }
    list.innerHTML = filtered
      .map((p) => {
        const id = Number(p.id)
        const selected = id === selectedProfessionalId
        return `<button type="button" data-new-psych-id="${id}" class="rounded-lg border px-3 py-2 text-left text-sm ${selected ? 'border-violet-300 bg-violet-50 text-violet-800' : 'border-slate-200 bg-white text-slate-700'}">
          <p class="font-medium">${p.nombre}</p>
          <p class="text-xs text-slate-500">${p.especialidad || 'Sin especialidad'}</p>
          <p class="mt-1 text-[11px] uppercase tracking-wide ${professionalScope === 'my' ? 'text-emerald-600' : 'text-slate-400'}">${professionalScope === 'my' ? 'Mi psicologo' : 'Nuevo psicologo'}</p>
        </button>`
      })
      .join('')
    list.querySelectorAll<HTMLButtonElement>('button[data-new-psych-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        selectedProfessionalId = Number(btn.dataset.newPsychId || 0)
        refillProfessionalSelect()
        const fecha = document.querySelector<HTMLInputElement>('#fecha-cita-date')?.value || ''
        if (fecha) await fetchAndRenderSlots(fecha)
      })
    })
  }
  const loadConversationMessages = async () => {
    const thread = document.querySelector<HTMLElement>('#chat-thread')
    const activeName = document.querySelector<HTMLElement>('#patient-chat-active-name')
    if (!thread) return
    if (!currentConversationId) {
      thread.innerHTML = '<p>Selecciona una conversacion para empezar.</p>'
      if (activeName) activeName.textContent = 'Sin chat seleccionado'
      return
    }
    const currentConv = patientConversations.find((c) => Number(c.id) === currentConversationId)
    if (activeName) activeName.textContent = String(currentConv?.profesional_nombre || 'Psicologo')
    const r = await fetch(`${API_BASE_URL}/chat/conversaciones/${currentConversationId}/mensajes/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const b = await r.json()
    if (!r.ok) {
      thread.innerHTML = `<p>${b.detail || 'No se pudo cargar el chat'}</p>`
      return
    }
    const messages = b.mensajes || []
    thread.innerHTML = messages
      .map((m: Record<string, string>) => {
        const mine = m.emisor === 'paciente'
        const timeLabel = m.fecha_envio
          ? new Date(String(m.fecha_envio)).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
          : ''
        return `<div class="mb-2 flex ${mine ? 'justify-end' : 'justify-start'}">
          <div class="max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${mine ? 'bg-violet-500 text-white rounded-br-md' : 'bg-white text-slate-800 border border-slate-200 rounded-bl-md'}">
            <p class="whitespace-pre-wrap break-words">${String(m.contenido || '')}</p>
            <p class="mt-1 text-[11px] ${mine ? 'text-violet-100' : 'text-slate-400'}">${timeLabel}</p>
          </div>
        </div>`
      })
      .join('') || '<p class="text-sm text-slate-500">Sin mensajes</p>'
    thread.scrollTop = thread.scrollHeight
  }
  const renderPatientConversations = () => {
    const box = document.querySelector<HTMLElement>('#chat-conversation-list')
    if (!box) return
    if (!patientConversations.length) {
      box.innerHTML = '<p class="text-xs text-slate-500">Aun no tienes conversaciones.</p>'
      return
    }
    box.innerHTML = patientConversations
      .map((c) => {
        const id = Number(c.id || 0)
        const selected = id === currentConversationId
        const lastMov = c.ultimo_movimiento ? new Date(String(c.ultimo_movimiento)).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : ''
        return `<button type="button" data-chat-conv-id="${id}" class="w-full rounded border px-2 py-2 text-left text-xs ${selected ? 'border-violet-300 bg-violet-50 text-violet-800' : 'border-slate-200 bg-white text-slate-700'}">
          <p class="font-medium">${String(c.profesional_nombre || 'Psicologo')}</p>
          <p class="text-[11px] text-slate-500">${lastMov}</p>
        </button>`
      })
      .join('')
    box.querySelectorAll<HTMLButtonElement>('button[data-chat-conv-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        currentConversationId = Number(btn.dataset.chatConvId || 0)
        const conv = patientConversations.find((c) => Number(c.id) === currentConversationId)
        if (conv?.profesional_id) selectedProfessionalId = Number(conv.profesional_id)
        renderPatientConversations()
        await loadConversationMessages()
      })
    })
  }
  const loadPatientConversations = async () => {
    const convRes = await fetch(`${API_BASE_URL}/chat/conversaciones/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const convBody = await convRes.json()
    if (!convRes.ok) return
    patientConversations = (convBody.conversaciones || [])
      .sort((a: Record<string, string | number>, b: Record<string, string | number>) =>
        String(b.ultimo_movimiento || '').localeCompare(String(a.ultimo_movimiento || '')),
      )
    if (!currentConversationId && patientConversations.length) {
      const first = patientConversations[0]
      currentConversationId = Number(first.id || 0)
      selectedProfessionalId = Number(first.profesional_id || selectedProfessionalId || 0)
    } else {
      syncProfessionalFromActiveChat()
    }
    renderPatientConversations()
  }
  const getCurrentProfessionalId = () => {
    return selectedProfessionalId
  }

  // --- Mood Calendar state (declared before load so load() can assign) ---
  type EmotionRecord = { id: number; fecha: string; emocion: string; intensidad: number; nota?: string }
  let allEmotionRecords: EmotionRecord[] = []
  let moodCalMonth = new Date().getMonth()
  let moodCalYear = new Date().getFullYear()
  let moodCalSelectedDate = ''

  const intensityColor = (val: number): string => {
    if (val <= 2) return 'bg-red-300'
    if (val <= 4) return 'bg-orange-300'
    if (val <= 6) return 'bg-yellow-300'
    if (val <= 8) return 'bg-lime-300'
    return 'bg-emerald-400'
  }

  const moodMonthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

  const renderMoodCalendar = () => {
    const grid = document.querySelector<HTMLElement>('#mood-cal-grid')
    const title = document.querySelector<HTMLElement>('#mood-cal-title')
    const detail = document.querySelector<HTMLElement>('#mood-cal-detail')
    if (!grid || !title) return
    title.textContent = `${moodMonthNames[moodCalMonth]} ${moodCalYear}`

    const firstDay = new Date(moodCalYear, moodCalMonth, 1)
    const lastDay = new Date(moodCalYear, moodCalMonth + 1, 0)
    let startDow = firstDay.getDay() - 1
    if (startDow < 0) startDow = 6

    const recordsByDate = new Map<string, EmotionRecord[]>()
    for (const r of allEmotionRecords) {
      const d = r.fecha.slice(0, 10)
      if (!recordsByDate.has(d)) recordsByDate.set(d, [])
      recordsByDate.get(d)!.push(r)
    }

    let html = ''
    for (let i = 0; i < startDow; i++) {
      html += '<div class="h-10"></div>'
    }
    const today = formatLocalDateISO(new Date())
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const dateStr = `${moodCalYear}-${String(moodCalMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const entries = recordsByDate.get(dateStr) || []
      const isToday = dateStr === today
      const avg = entries.length > 0 ? Math.round(entries.reduce((s, e) => s + e.intensidad, 0) / entries.length) : 0
      const colorCls = avg > 0 ? intensityColor(avg) : 'bg-slate-100'
      const todayRing = isToday ? 'ring-2 ring-violet-400' : ''
      const cursor = entries.length > 0 ? 'cursor-pointer hover:scale-110' : ''
      html += `<button data-cal-date="${dateStr}" class="mood-cal-day flex h-10 w-full items-center justify-center rounded-lg text-xs font-medium text-slate-700 transition ${colorCls} ${todayRing} ${cursor}">${day}</button>`
    }
    grid.innerHTML = html

    const showDetailForDate = (dateStr: string) => {
      if (!detail) return
      const entries = recordsByDate.get(dateStr) || []
      if (!entries.length) {
        detail.classList.add('hidden')
        moodCalSelectedDate = ''
        return
      }
      moodCalSelectedDate = dateStr
      detail.classList.remove('hidden')
      detail.innerHTML = `<p class="mb-2 font-medium text-violet-800">${new Date(dateStr + 'T12:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</p>` +
        entries.map((e) => {
          const notaHtml = e.nota ? `<p class="mt-1 rounded bg-white/70 px-2 py-1 text-xs text-slate-600 italic">${e.nota}</p>` : ''
          return `<div class="mb-2 flex items-start justify-between gap-2 last:mb-0"><div class="flex-1"><p class="flex items-center gap-2"><span class="inline-block h-2.5 w-2.5 rounded-full ${intensityColor(e.intensidad)}"></span><span class="font-medium text-slate-700">${e.intensidad}/10</span> <span class="text-slate-400">&middot;</span> <span class="capitalize text-slate-500">${e.emocion}</span></p>${notaHtml}</div><button data-delete-emotion-id="${e.id}" class="ml-2 flex-shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 transition" title="Eliminar registro"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg></button></div>`
        }).join('')

      detail.querySelectorAll<HTMLButtonElement>('[data-delete-emotion-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.deleteEmotionId)
          if (!id) return
          btn.disabled = true
          const res = await fetch(`${API_BASE_URL}/emociones/`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
          })
          if (res.ok) {
            allEmotionRecords = allEmotionRecords.filter((r) => r.id !== id)
            renderMoodCalendar()
          } else {
            const body = await res.json()
            showMsg(body.detail || 'No se pudo eliminar', false)
          }
        })
      })
    }

    if (moodCalSelectedDate) {
      showDetailForDate(moodCalSelectedDate)
    } else if (detail) {
      detail.classList.add('hidden')
    }

    grid.querySelectorAll<HTMLButtonElement>('.mood-cal-day').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dateStr = btn.dataset.calDate || ''
        showDetailForDate(dateStr)
      })
    })
  }

  const load = async () => {
    const meRes = await fetch(`${API_BASE_URL}/auth/me/`, { headers: { Authorization: `Bearer ${token}` } })
    const me = await meRes.json()
    if (!meRes.ok || me.rol !== 'paciente') {
      window.location.href = '/mindlink'
      return
    }
    const profRes = await fetch(`${API_BASE_URL}/profesionales/`, { headers: { Authorization: `Bearer ${token}` } })
    const profBody = await profRes.json()
    allProfessionals = profBody.profesionales || []
    currentPatientId = Number(me.id || 0)
    ;(document.querySelector<HTMLInputElement>('#profile-nombre') as HTMLInputElement | null)!.value = String(me.nombre || '')
    ;(document.querySelector<HTMLInputElement>('#profile-telefono') as HTMLInputElement | null)!.value = String(me.telefono || '')
    ;(document.querySelector<HTMLInputElement>('#profile-ciudad') as HTMLInputElement | null)!.value = String(me.ciudad_residencia || '')
    const fechaConsulta = document.querySelector<HTMLInputElement>('#fecha-cita-date')
    if (fechaConsulta) {
      const minD = todayMidnight()
      const maxD = new Date(minD)
      maxD.setDate(maxD.getDate() + 90)
      fechaConsulta.min = formatLocalDateISO(minD)
      fechaConsulta.max = formatLocalDateISO(maxD)
      if (!fechaConsulta.value || fechaConsulta.value < fechaConsulta.min) {
        fechaConsulta.value = formatLocalDateISO(minD)
      }
    }
    const citasRes = await fetch(`${API_BASE_URL}/citas/`, { headers: { Authorization: `Bearer ${token}` } })
    const citasBody = await citasRes.json()
    myProfessionalIds = new Set<number>(
      (citasBody.citas || [])
        .map((c: Record<string, string | number>) => Number(c.profesional_id || 0))
        .filter((v: number) => v > 0),
    )
    applyProfessionalScopeStyles()
    refillProfessionalSelect()
    const box = document.querySelector<HTMLElement>('#patient-citas')
    if (box) {
      box.innerHTML = (citasBody.citas || []).map((c: Record<string, string | number>) => `
        <div class="rounded-lg border border-slate-200 p-3">
          <p class="font-medium text-slate-800">${new Date(String(c.fecha_hora)).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</p>
          <p class="text-slate-600">${c.profesional_nombre}</p>
          <p class="text-xs text-slate-500">${c.duracion_min || '-'} min</p>
          <p class="mt-1 inline-flex rounded-full px-2 py-0.5 text-xs ${c.estado === 'confirmada' ? 'bg-emerald-100 text-emerald-700' : c.estado === 'cancelada' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}">${c.estado}</p>
          <div class="mt-2 flex gap-2">
            <button data-cancel-id="${c.id}" class="rounded bg-rose-100 px-2 py-1 text-xs text-rose-700">Cancelar</button>
          </div>
        </div>
      `).join('') || '<p class="text-slate-500">No hay citas.</p>'
      box.querySelectorAll<HTMLButtonElement>('button[data-cancel-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.cancelId
          if (!id) return
          const r = await fetch(`${API_BASE_URL}/citas/${id}/estado/`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: 'cancelada' }),
          })
          const b = await r.json()
          showMsg(r.ok ? 'Cita cancelada' : b.detail || 'No se pudo cancelar', r.ok)
          await load()
        })
      })
    }
    const emRes = await fetch(`${API_BASE_URL}/emociones/`, { headers: { Authorization: `Bearer ${token}` } })
    const emBody = await emRes.json()
    allEmotionRecords = emBody.registros || []
    renderMoodCalendar()
    const qState = document.querySelector<HTMLElement>('#questionnaire-state')
    const qRes = await fetch(`${API_BASE_URL}/cuestionarios/inicial/`, { headers: { Authorization: `Bearer ${token}` } })
    const qBody = await qRes.json()
    if (qState && qRes.ok) {
      const pending = qBody.siguiente_pregunta
      qState.textContent = pending
        ? `Siguiente pregunta: ${pending.texto || 'pendiente'}`
        : 'Cuestionario inicial completado'
    }
    await loadPatientConversations()
    await loadConversationMessages()

    const fechaInput = document.querySelector<HTMLInputElement>('#fecha-cita-date')
    if (fechaInput?.value) {
      await fetchAndRenderSlots(fechaInput.value)
    }
  }
  const fetchAndRenderSlots = async (fecha: string) => {
    const slotsBox = document.querySelector<HTMLElement>('#slots-box')
    if (!slotsBox) return
    type SlotWithProfessional = Record<string, string | number> & {
      profesional_id: number
      profesional_nombre: string
    }
    const specialtyRaw = getSpecialtyFilter()
    const selectedDuration = Number(document.querySelector<HTMLSelectElement>('#duracion-filter')?.value || 0)
    const maxPrice = Number(document.querySelector<HTMLInputElement>('#price-filter')?.value || 0)
    const hasAtLeastOneFilter = Boolean(fecha || specialtyRaw || selectedDuration || maxPrice > 0)
    if (!hasAtLeastOneFilter) {
      showMsg('Aplica al menos un filtro: especialidad, fecha, duracion o precio.', false)
      return
    }
    const filteredProfessionals = getBookingFilteredProfessionals()
    if (!filteredProfessionals.length) {
      slotsBox.innerHTML = '<p class="text-sm text-slate-500">No hay psicologos para los filtros seleccionados.</p>'
      return
    }
    const todayIso = formatLocalDateISO(new Date())
    const requestPath = (id: number) =>
      fecha
        ? `${API_BASE_URL}/profesionales/${id}/slots/?date=${fecha}`
        : `${API_BASE_URL}/profesionales/${id}/slots/proximos/?from_date=${todayIso}`
    const rawResults = await Promise.all(
      filteredProfessionals.map(async (p) => {
        const id = Number(p.id)
        const res = await fetch(requestPath(id), { headers: { Authorization: `Bearer ${token}` } })
        const body = (await res.json()) as {
          slots?: Array<Record<string, string | number>>
          detail?: string
        }
        if (!res.ok) return [] as SlotWithProfessional[]
        return (body.slots || []).map((s) => ({
          ...s,
          profesional_id: id,
          profesional_nombre: String(p.nombre || 'Profesional'),
        })) as SlotWithProfessional[]
      }),
    )
    const slotListRaw: SlotWithProfessional[] = rawResults.flat()
    slotListRaw.sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)))
    let slotList: SlotWithProfessional[] = selectedDuration
      ? slotListRaw.filter((s) => Number(s.duracion_min) === selectedDuration)
      : slotListRaw
    if (maxPrice > 0) {
      slotList = slotList.filter((s) => Number(s.precio) <= maxPrice)
    }
    const compactedByProfessional = new Map<number, SlotWithProfessional[]>()
    slotList.forEach((slot) => {
      const pid = Number(slot.profesional_id)
      const prev = compactedByProfessional.get(pid) || []
      const slotStart = new Date(String(slot.inicio)).getTime()
      const slotDurationMin = Number(slot.duracion_min || 0)
      const last = prev[prev.length - 1]
      if (!last) {
        prev.push(slot)
        compactedByProfessional.set(pid, prev)
        return
      }
      const lastStart = new Date(String(last.inicio)).getTime()
      const lastDurationMs = Number(last.duracion_min || slotDurationMin) * 60_000
      if (slotStart >= lastStart + lastDurationMs) {
        prev.push(slot)
        compactedByProfessional.set(pid, prev)
      }
    })
    slotList = Array.from(compactedByProfessional.values())
      .flat()
      .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)))
    const emptyHint = '<p class="text-sm text-slate-500">No hay horarios libres para los filtros actuales.</p>'
    slotsBox.innerHTML =
      slotList.map((s: Record<string, string | number>) => `
      <button type="button" class="slot-btn rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-left text-sm hover:bg-violet-100" data-inicio="${s.inicio}">
        <p class="font-medium text-violet-700">${new Date(String(s.inicio)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        <p class="text-xs text-slate-600">${s.duracion_min} min · ${s.precio} €</p>
        <p class="text-xs text-slate-500">${s.profesional_nombre}</p>
      </button>
    `).join('') || emptyHint

    slotsBox.querySelectorAll<HTMLButtonElement>('.slot-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const inicio = btn.dataset.inicio
        if (!inicio) return
        const slot = slotList.find((s) => String(s.inicio) === inicio)
        const profesionalId = Number(slot?.profesional_id || 0)
        if (!profesionalId) {
          showMsg('No se pudo identificar el psicologo del horario', false)
          return
        }
        const res = await fetch(`${API_BASE_URL}/citas/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ profesional_id: profesionalId, fecha_hora: inicio }),
        })
        const body = await res.json()
        if (!res.ok) {
          showMsg(body.detail || 'Error al crear cita', false)
          return
        }
        showMsg('Cita creada correctamente', true)
        await load()
      })
    })

    const nextBox = document.querySelector<HTMLElement>('#next-slots-box')
    if (nextBox) {
      nextBox.innerHTML = ''
      nextBox.innerHTML = slotList.length
        ? '<p class="text-sm text-slate-500">Ya tienes huecos para los filtros seleccionados.</p>'
        : '<p class="text-sm text-slate-500">Prueba con otros filtros para ver mas opciones.</p>'
    }
  }

  document.querySelector<HTMLButtonElement>('#cargar-slots')?.addEventListener('click', async () => {
    const fecha = document.querySelector<HTMLInputElement>('#fecha-cita-date')?.value || ''
    await fetchAndRenderSlots(fecha)
  })

  document.querySelector<HTMLInputElement>('#fecha-cita-date')?.addEventListener('change', async () => {
    const fecha = document.querySelector<HTMLInputElement>('#fecha-cita-date')?.value || ''
    if (fecha) await fetchAndRenderSlots(fecha)
  })
  document.querySelector<HTMLButtonElement>('#scope-my-psych')?.addEventListener('click', async () => {
    professionalScope = 'my'
    applyProfessionalScopeStyles()
    refillProfessionalSelect()
    const fecha = document.querySelector<HTMLInputElement>('#fecha-cita-date')?.value || ''
    if (fecha) await fetchAndRenderSlots(fecha)
  })
  document.querySelector<HTMLButtonElement>('#scope-new-psych')?.addEventListener('click', async () => {
    professionalScope = 'new'
    applyProfessionalScopeStyles()
    refillProfessionalSelect()
    const fecha = document.querySelector<HTMLInputElement>('#fecha-cita-date')?.value || ''
    if (fecha) await fetchAndRenderSlots(fecha)
  })
  document.querySelector<HTMLInputElement>('#specialty-filter')?.addEventListener('input', async () => {
    refillProfessionalSelect()
    const fecha = document.querySelector<HTMLInputElement>('#fecha-cita-date')?.value || ''
    if (fecha) await fetchAndRenderSlots(fecha)
  })
  document.querySelector<HTMLInputElement>('#price-filter')?.addEventListener('input', async () => {
    const fecha = document.querySelector<HTMLInputElement>('#fecha-cita-date')?.value || ''
    if (fecha) await fetchAndRenderSlots(fecha)
  })
  document.querySelector<HTMLSelectElement>('#duracion-filter')?.addEventListener('change', async () => {
    const fecha = document.querySelector<HTMLInputElement>('#fecha-cita-date')?.value || ''
    if (fecha) await fetchAndRenderSlots(fecha)
  })
  document.querySelector<HTMLButtonElement>('#logout')?.addEventListener('click', () => {
    localStorage.removeItem('mindlink_token')
    localStorage.removeItem('mindlink_user')
    window.location.href = '/mindlink'
  })
  document.querySelector<HTMLButtonElement>('#save-profile')?.addEventListener('click', async () => {
    const payload = {
      nombre: document.querySelector<HTMLInputElement>('#profile-nombre')?.value || '',
      telefono: document.querySelector<HTMLInputElement>('#profile-telefono')?.value || '',
      ciudad_residencia: document.querySelector<HTMLInputElement>('#profile-ciudad')?.value || '',
    }
    const res = await fetch(`${API_BASE_URL}/auth/profile/`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.json()
    showMsg(res.ok ? 'Perfil actualizado' : body.detail || 'Error perfil', res.ok)
  })
  // --- Mood Calendar navigation ---
  document.querySelector<HTMLButtonElement>('#mood-cal-prev')?.addEventListener('click', () => {
    moodCalMonth--
    if (moodCalMonth < 0) { moodCalMonth = 11; moodCalYear-- }
    renderMoodCalendar()
  })
  document.querySelector<HTMLButtonElement>('#mood-cal-next')?.addEventListener('click', () => {
    moodCalMonth++
    if (moodCalMonth > 11) { moodCalMonth = 0; moodCalYear++ }
    renderMoodCalendar()
  })

  const intensityRange = document.querySelector<HTMLInputElement>('#mood-intensity-range')
  const intensityLabel = document.querySelector<HTMLElement>('#mood-intensity-label')
  intensityRange?.addEventListener('input', () => {
    if (intensityLabel) intensityLabel.textContent = intensityRange.value
  })

  const moodFromIntensity = (val: number): string => {
    if (val <= 2) return 'muy mal'
    if (val <= 4) return 'mal'
    if (val <= 5) return 'regular'
    if (val <= 7) return 'bien'
    if (val <= 9) return 'muy bien'
    return 'genial'
  }

  document.querySelector<HTMLButtonElement>('#save-emotion')?.addEventListener('click', async () => {
    const intensidad = Number(intensityRange?.value || 5)
    const nota = document.querySelector<HTMLTextAreaElement>('#mood-nota')?.value || ''
    const emocion = moodFromIntensity(intensidad)
    const saveBtn = document.querySelector<HTMLButtonElement>('#save-emotion')
    if (saveBtn) saveBtn.disabled = true
    const res = await fetch(`${API_BASE_URL}/emociones/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ emocion, intensidad, nota }),
    })
    const body = await res.json()
    showMsg(res.ok ? 'Registro guardado correctamente' : body.detail || 'Error al registrar', res.ok)
    if (res.ok) {
      const notaInput = document.querySelector<HTMLTextAreaElement>('#mood-nota')
      if (notaInput) notaInput.value = ''
      await load()
    }
    if (saveBtn) saveBtn.disabled = false
  })

  type WellbeingBotTurn = { role: 'user' | 'assistant'; content: string }
  const wellbeingBotHistory: WellbeingBotTurn[] = []
  const wellbeingBotThread = document.querySelector<HTMLElement>('#wellbeing-bot-thread')
  const wellbeingBotInput = document.querySelector<HTMLTextAreaElement>('#wellbeing-bot-input')
  const wellbeingBotMsg = document.querySelector<HTMLParagraphElement>('#wellbeing-bot-msg')
  const wellbeingBotSource = document.querySelector<HTMLElement>('#wellbeing-bot-source')
  const wellbeingBotIaBanner = document.querySelector<HTMLElement>('#wellbeing-bot-ia-banner')
  let sendingWellbeingBot = false

  const refreshWellbeingBotStatus = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/chatbot/estado/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json()
      if (!res.ok || !wellbeingBotIaBanner) return
      if (body.ia_activa) {
        wellbeingBotIaBanner.classList.add('hidden')
        wellbeingBotIaBanner.textContent = ''
      } else {
        wellbeingBotIaBanner.classList.remove('hidden')
        wellbeingBotIaBanner.innerHTML =
          'Modo basico activo (sin IA conversacional). Para respuestas al estilo ChatGPT: instala <strong>Ollama</strong> y ejecuta <code>ollama pull llama3.2</code>, o configura una API key de <strong>Groq</strong> o <strong>Gemini</strong> en el backend.'
      }
    } catch {
      /* silencioso */
    }
  }

  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const renderWellbeingBot = () => {
    if (!wellbeingBotThread) return
    if (!wellbeingBotHistory.length) {
      wellbeingBotThread.innerHTML =
        '<p class="text-sm text-slate-500">Hola. Soy tu asistente de bienestar. Puedes contarme como te sientes o preguntarme por estrategias de autocuidado.</p>'
      return
    }
    wellbeingBotThread.innerHTML = wellbeingBotHistory
      .map((t) => {
        const mine = t.role === 'user'
        return `<div class="mb-2 flex ${mine ? 'justify-end' : 'justify-start'}">
          <div class="max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${mine ? 'bg-indigo-500 text-white rounded-br-md' : 'bg-white text-slate-800 border border-slate-200 rounded-bl-md'}">
            <p class="whitespace-pre-wrap break-words">${escapeHtml(t.content)}</p>
          </div>
        </div>`
      })
      .join('')
    wellbeingBotThread.scrollTop = wellbeingBotThread.scrollHeight
  }

  const showWellbeingBotMsg = (text: string, ok: boolean) => {
    if (!wellbeingBotMsg) return
    wellbeingBotMsg.textContent = text
    wellbeingBotMsg.className = `mt-2 rounded-lg border px-2 py-1 text-xs ${ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`
  }

  const sendWellbeingBotMessage = async () => {
    if (sendingWellbeingBot || !wellbeingBotInput) return
    const text = wellbeingBotInput.value.trim()
    if (!text) {
      showWellbeingBotMsg('Escribe un mensaje antes de enviar', false)
      return
    }
    sendingWellbeingBot = true
    const sendBtn = document.querySelector<HTMLButtonElement>('#wellbeing-bot-send')
    if (sendBtn) sendBtn.disabled = true
    wellbeingBotHistory.push({ role: 'user', content: text })
    wellbeingBotInput.value = ''
    renderWellbeingBot()
    if (wellbeingBotThread) {
      wellbeingBotThread.insertAdjacentHTML(
        'beforeend',
        '<p id="wellbeing-bot-typing" class="text-xs text-slate-400 italic">Escribiendo...</p>',
      )
      wellbeingBotThread.scrollTop = wellbeingBotThread.scrollHeight
    }
    try {
      const res = await fetch(`${API_BASE_URL}/chatbot/reply/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensaje: text,
          historial: wellbeingBotHistory.slice(0, -1),
        }),
      })
      const body = await res.json()
      document.querySelector('#wellbeing-bot-typing')?.remove()
      if (!res.ok) {
        wellbeingBotHistory.pop()
        renderWellbeingBot()
        showWellbeingBotMsg(body.detail || 'No se pudo obtener respuesta', false)
        return
      }
      const reply = String(body.respuesta || '').trim()
      if (!reply) {
        wellbeingBotHistory.pop()
        renderWellbeingBot()
        showWellbeingBotMsg('Respuesta vacia del asistente', false)
        return
      }
      wellbeingBotHistory.push({ role: 'assistant', content: reply })
      renderWellbeingBot()
      if (wellbeingBotSource) {
        const fuente = String(body.fuente || 'reglas')
        const labels: Record<string, string> = {
          ollama: 'Conversacion con IA (Ollama)',
          groq: 'Conversacion con IA (Groq)',
          gemini: 'Conversacion con IA (Gemini)',
          reglas: 'Modo basico (sin modelo de lenguaje)',
          'reglas-crisis': 'Apoyo de crisis',
        }
        wellbeingBotSource.textContent = labels[fuente] || fuente
      }
      if (!body.ia_activa && wellbeingBotIaBanner) {
        wellbeingBotIaBanner.classList.remove('hidden')
        wellbeingBotIaBanner.innerHTML =
          'Respuesta en modo basico. Para charlar con IA real, activa Ollama, Groq o Gemini en el servidor.'
      } else if (body.ia_activa && wellbeingBotIaBanner) {
        wellbeingBotIaBanner.classList.add('hidden')
      }
    } catch {
      document.querySelector('#wellbeing-bot-typing')?.remove()
      wellbeingBotHistory.pop()
      renderWellbeingBot()
      showWellbeingBotMsg('Error de conexion con el asistente', false)
    } finally {
      sendingWellbeingBot = false
      if (sendBtn) sendBtn.disabled = false
      wellbeingBotInput?.focus()
    }
  }

  document.querySelector<HTMLButtonElement>('#wellbeing-bot-send')?.addEventListener('click', () => {
    void sendWellbeingBotMessage()
  })
  wellbeingBotInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendWellbeingBotMessage()
    }
  })
  document.querySelector<HTMLButtonElement>('#wellbeing-bot-clear')?.addEventListener('click', () => {
    wellbeingBotHistory.length = 0
    renderWellbeingBot()
    if (wellbeingBotSource) wellbeingBotSource.textContent = ''
    showWellbeingBotMsg('Conversacion reiniciada', true)
  })
  renderWellbeingBot()
  void refreshWellbeingBotStatus()

  document.querySelector<HTMLButtonElement>('#run-questionnaire')?.addEventListener('click', async () => {
    const btn = document.querySelector<HTMLButtonElement>('#run-questionnaire')
    if (btn) btn.disabled = true
    const qRes = await fetch(`${API_BASE_URL}/cuestionarios/inicial/`, { headers: { Authorization: `Bearer ${token}` } })
    const qBody = await qRes.json()
    if (!qRes.ok) {
      showMsg(qBody.detail || 'No se pudo cargar cuestionario', false)
      if (btn) btn.disabled = false
      return
    }
    const pregunta = qBody.siguiente_pregunta || (qBody.preguntas || [])[0]
    if (!pregunta) {
      showMsg('Cuestionario ya completado', true)
      if (btn) btn.disabled = false
      return
    }
    const respuestas = [{ pregunta_id: pregunta.id, valor: String(Math.floor(Math.random() * 4) + 5) }]
    const sRes = await fetch(`${API_BASE_URL}/cuestionarios/inicial/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ respuestas }),
    })
    const sBody = await sRes.json()
    if (sRes.ok) {
      const risk = sBody?.resultado?.nivel_riesgo ? ` · Riesgo ${sBody.resultado.nivel_riesgo}` : ''
      showMsg(`Respuesta enviada${risk}`, true)
      await load()
    } else {
      showMsg(sBody.detail || 'No se pudo enviar', false)
    }
    if (btn) btn.disabled = false
  })
  const chatPatientMsg = document.querySelector<HTMLParagraphElement>('#chat-patient-msg')
  const showChatMsg = (text: string, ok: boolean) => {
    if (!chatPatientMsg) return
    chatPatientMsg.textContent = text
    chatPatientMsg.className = `mt-2 rounded-lg border px-2 py-1 text-xs ${ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`
    window.setTimeout(() => {
      if (chatPatientMsg.textContent === text) chatPatientMsg.classList.add('hidden')
    }, 4000)
  }
  let sendingChatMessage = false
  document.querySelector<HTMLButtonElement>('#send-chat-message')?.addEventListener('click', async () => {
    if (sendingChatMessage) return
    const btn = document.querySelector<HTMLButtonElement>('#send-chat-message')
    const input = document.querySelector<HTMLTextAreaElement>('#chat-message')
    const contenido = (input?.value || '').trim()
    if (!contenido) {
      showChatMsg('Escribe un mensaje antes de enviar', false)
      return
    }
    syncProfessionalFromActiveChat()
    const activeConv = patientConversations.find((c) => Number(c.id) === currentConversationId)
    const profesionalId = getCurrentProfessionalId() || Number(activeConv?.profesional_id || 0)
    if (!currentConversationId && !profesionalId) {
      showChatMsg('Selecciona un contacto en la lista de la derecha', false)
      return
    }
    sendingChatMessage = true
    if (btn) btn.disabled = true
    try {
      if (!currentConversationId && profesionalId) {
        const existing = patientConversations.find((c) => Number(c.profesional_id) === profesionalId)
        if (existing) currentConversationId = Number(existing.id || 0)
      }
      if (!currentConversationId && profesionalId) {
        const convRes = await fetch(`${API_BASE_URL}/chat/conversaciones/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ profesional_id: profesionalId }),
        })
        const convBody = await convRes.json()
        if (!convRes.ok) {
          showChatMsg(convBody.detail || 'No se pudo abrir el chat', false)
          return
        }
        currentConversationId = Number(convBody.id || 0)
        await loadPatientConversations()
      }
      if (!currentConversationId) {
        showChatMsg('Selecciona un contacto en la lista de la derecha', false)
        return
      }
      const msgRes = await fetch(`${API_BASE_URL}/chat/conversaciones/${currentConversationId}/mensajes/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contenido }),
      })
      const msgBody = await msgRes.json()
      if (!msgRes.ok) {
        showChatMsg(msgBody.detail || 'No se pudo enviar el mensaje', false)
        return
      }
      if (input) input.value = ''
      await loadPatientConversations()
      await loadConversationMessages()
    } finally {
      sendingChatMessage = false
      if (btn) btn.disabled = false
    }
  })
  document.querySelector<HTMLTextAreaElement>('#chat-message')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      document.querySelector<HTMLButtonElement>('#send-chat-message')?.click()
    }
  })
  const patientChatPollWindow = window as Window & { __mindlinkPatientChatPoll?: number }
  if (patientChatPollWindow.__mindlinkPatientChatPoll) {
    window.clearInterval(patientChatPollWindow.__mindlinkPatientChatPoll)
  }
  patientChatPollWindow.__mindlinkPatientChatPoll = window.setInterval(async () => {
    await loadPatientConversations()
    await loadConversationMessages()
  }, 4000)
  const patientPanelPollWindow = window as Window & { __mindlinkPatientPanelPoll?: number }
  if (patientPanelPollWindow.__mindlinkPatientPanelPoll) {
    window.clearInterval(patientPanelPollWindow.__mindlinkPatientPanelPoll)
  }
  patientPanelPollWindow.__mindlinkPatientPanelPoll = window.setInterval(async () => {
    await load()
  }, 10000)
  document.querySelector<HTMLButtonElement>('#tab-paciente-citas')?.addEventListener('click', () => showPatientSection('citas'))
  document.querySelector<HTMLButtonElement>('#tab-paciente-bienestar')?.addEventListener('click', () => showPatientSection('bienestar'))
  document.querySelector<HTMLButtonElement>('#tab-paciente-asistente')?.addEventListener('click', () => showPatientSection('asistente'))
  document.querySelector<HTMLButtonElement>('#tab-paciente-chats')?.addEventListener('click', () => showPatientSection('chats'))
  showPatientSection('citas')
  await load()
}

async function renderProfessionalPanel(): Promise<void> {
  const token = localStorage.getItem('mindlink_token')
  if (!token) {
    window.location.href = '/mindlink-trabajador'
    return
  }
  app.innerHTML = `
    <main class="mx-auto min-h-screen w-full max-w-6xl px-4 py-8">
      <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          ${BRAND_LOGO_SM}
          <h1 class="text-2xl font-semibold text-slate-800">Panel del profesional</h1>
        </div>
        <button id="logout-prof" class="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-300">Cerrar sesion</button>
      </header>
      <section class="mb-4 flex flex-wrap gap-2">
        <button id="tab-agenda" class="rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white">Agenda</button>
        <button id="tab-citas" class="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300">Citas asignadas</button>
        <button id="tab-pacientes" class="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300">Pacientes</button>
        <button id="tab-chats" class="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300">Chats</button>
      </section>
      <section id="view-agenda" class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div class="mb-4">
          <h2 class="text-lg font-semibold text-slate-800">Agenda</h2>
          <p class="mt-1 text-sm text-slate-600">Plantilla semanal habitual y ajustes por fechas concretas (un miercoles distinto de otro).</p>
        </div>
        <div class="mb-4 flex flex-wrap gap-2">
          <button type="button" id="sub-agenda-plantilla" class="rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white">Plantilla semanal</button>
          <button type="button" id="sub-agenda-fecha" class="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300">Por fecha</button>
        </div>

        <div id="panel-plantilla" class="rounded-xl border border-slate-200 p-4">
              <p class="mb-2 text-sm font-semibold text-slate-800">Tu horario habitual</p>
              <p id="plantilla-validation" class="mb-3 hidden rounded border px-2 py-1 text-xs"></p>
          <ol class="mb-3 list-decimal space-y-1 ps-5 text-xs text-slate-600">
            <li>Elegir el dia de la semana y desde cuando hasta cuando trabajas.</li>
            <li>La duracion y el precio se configuran de forma global en Politicas de reserva.</li>
            <li>Pulsa <span class="font-medium text-slate-800">Guardar</span>. Para el mismo dia puedes pulsar <span class="font-medium text-slate-800">Anadir tramo</span> (por ejemplo manana y tarde).</li>
          </ol>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[560px] text-sm">
              <thead>
                <tr class="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th class="pb-2 pr-2">Dia</th>
                  <th class="pb-2 pr-2">Activo</th>
                  <th class="pb-2 pr-2">Desde</th>
                  <th class="pb-2 pr-2">Hasta</th>
                  <th class="pb-2"></th>
                </tr>
              </thead>
              <tbody id="plantilla-rows" class="align-middle"></tbody>
            </table>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" id="plantilla-add-row" class="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-800 ring-1 ring-slate-200">Anadir otro tramo</button>
            <button type="button" id="save-plantilla" class="rounded-lg bg-violet-500 px-3 py-2 text-xs font-medium text-white">Guardar horario habitual</button>
          </div>
          <div class="mt-4 rounded-lg border border-violet-100 bg-violet-50/40 p-3">
            <div class="mb-2 flex items-center justify-between">
              <p class="text-xs font-semibold text-violet-800">Vista previa de huecos semanales</p>
              <select id="preview-day" class="rounded border border-violet-200 bg-white px-2 py-1 text-xs text-slate-700">
                <option value="0">Lunes</option>
                <option value="1">Martes</option>
                <option value="2">Miercoles</option>
                <option value="3">Jueves</option>
                <option value="4">Viernes</option>
                <option value="5">Sabado</option>
                <option value="6">Domingo</option>
              </select>
            </div>
            <p id="preview-summary" class="text-xs text-slate-600"></p>
            <div id="preview-slots" class="mt-2 flex flex-wrap gap-1 text-xs"></div>
          </div>
        </div>

        <div id="panel-fecha" class="hidden rounded-xl border border-slate-200 p-4">
          <p class="mb-2 text-sm font-semibold text-slate-800">Tramos por fecha concreta</p>
          <p class="mb-3 text-xs text-slate-600">Para un dia concreto puedes sustituir la plantilla o sumar tramos extra. Los huecos no incluyen horas ya pasadas.</p>
          <div class="rounded-lg border border-slate-200 p-3">
            <div class="mb-3 flex items-center justify-between">
              <button type="button" id="calendar-prev" class="rounded px-2 py-1 text-sm ring-1 ring-slate-300">&lt;</button>
              <p id="calendar-title" class="text-base font-semibold text-slate-700"></p>
              <button type="button" id="calendar-next" class="rounded px-2 py-1 text-sm ring-1 ring-slate-300">&gt;</button>
            </div>
            <div id="calendar-grid" class="grid grid-cols-7 gap-2 text-sm"></div>
            <p id="calendar-selected" class="mt-3 text-sm text-slate-600"></p>
          </div>
          <div class="mt-4 rounded-lg border border-amber-100 bg-amber-50/80 p-3">
            <label class="flex cursor-pointer items-start gap-2 text-sm text-slate-800">
              <input type="checkbox" id="solo-este-dia-checkbox" class="mt-1 rounded border-slate-300"/>
              <span><span class="font-medium">Solo este dia</span>: ignorar mi horario habitual y usar unicamente los tramos que anada abajo (por ejemplo un festivo o un cambio puntual).</span>
            </label>
            <p class="mt-2 text-xs text-slate-600">Si no marcas esto, tus tramos de abajo se <span class="font-medium">suman</span> a tu horario habitual ese dia.</p>
            <button type="button" id="clear-excepcion-dia" class="mt-3 rounded bg-white px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200">Usar solo horario habitual (quitar ajuste de este dia)</button>
          </div>
          <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input id="disp-inicio" type="time" class="rounded border border-slate-200 px-2 py-2" value="09:00"/>
            <input id="disp-fin" type="time" class="rounded border border-slate-200 px-2 py-2" value="14:00"/>
            <p class="col-span-2 rounded border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-600">Duracion y precio heredados de Politicas de reserva.</p>
          </div>
          <div class="mt-3">
            <button type="button" id="add-disp-fecha" class="rounded bg-violet-500 px-3 py-2 text-xs font-medium text-white">Anadir tramo a esta fecha</button>
          </div>
          <div class="mt-4 rounded-lg bg-slate-50 p-3">
            <p class="text-xs font-semibold text-slate-700">Tramos del dia seleccionado</p>
            <div id="disp-fechas-selected-list" class="mt-2 space-y-2 text-xs"></div>
          </div>
          <div class="mt-3">
            <p class="text-xs font-semibold text-slate-700">Todos los tramos por fecha</p>
            <div id="disp-fechas-list" class="mt-2 space-y-2 text-xs"></div>
          </div>
        </div>

        <div class="mt-4 rounded-xl border border-slate-200 p-4">
          <p class="mb-2 text-sm font-semibold text-slate-800">Politicas de reserva</p>
          <p class="mb-3 text-xs text-slate-600">Controla antelacion, horizonte, descanso entre sesiones, duracion y precio global.</p>
          <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <label class="flex items-center rounded border border-slate-200 px-2 py-2">
              <input id="pol-antelacion" type="number" min="0" max="1440" class="w-full outline-none" value="30"/>
              <span class="text-xs text-slate-500">min antelacion</span>
            </label>
            <label class="flex items-center rounded border border-slate-200 px-2 py-2">
              <input id="pol-horizonte" type="number" min="1" max="365" class="w-full outline-none" value="90"/>
              <span class="text-xs text-slate-500">dias</span>
            </label>
            <label class="flex items-center rounded border border-slate-200 px-2 py-2">
              <input id="pol-descanso" type="number" min="0" max="180" class="w-full outline-none" value="0"/>
              <span class="text-xs text-slate-500">min descanso</span>
            </label>
            <label class="flex items-center rounded border border-slate-200 px-2 py-2">
              <input id="pol-duracion-sesion" type="number" min="15" max="180" step="5" class="w-full outline-none" value="50"/>
              <span class="text-xs text-slate-500">duracion</span>
            </label>
            <label class="flex items-center rounded border border-slate-200 px-2 py-2">
              <input id="pol-precio-sesion" type="number" min="0" step="1" class="w-full outline-none" value="50"/>
              <span class="text-xs text-slate-500">€ sesion</span>
            </label>
          </div>
          <div class="mt-3">
            <button type="button" id="save-politicas" class="rounded-lg bg-violet-500 px-3 py-2 text-xs font-medium text-white">Guardar politicas</button>
          </div>
        </div>

      </section>
      <section id="view-citas" class="hidden rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 class="mb-4 text-lg font-semibold text-slate-800">Citas asignadas</h2>
        <div id="prof-citas" class="space-y-2 text-sm"></div>
        <div class="mt-4 rounded-lg border border-slate-200 p-3">
          <p class="mb-2 text-sm font-medium text-slate-700">Seguimiento emocional por paciente</p>
          <div class="flex gap-2">
            <input id="trend-paciente-id" type="number" min="1" placeholder="ID paciente" class="rounded border border-slate-200 px-2 py-1 text-xs"/>
            <button id="load-trend" class="rounded bg-sky-600 px-2 py-1 text-xs text-white">Cargar tendencia</button>
          </div>
          <div id="trend-result" class="mt-2 text-xs text-slate-600"></div>
        </div>
      </section>
      <section id="view-pacientes" class="hidden rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 class="mb-4 text-lg font-semibold text-slate-800">Estado emocional de tus pacientes</h2>
        <div class="mb-4">
          <label class="mb-1 block text-sm font-medium text-slate-700">Selecciona un paciente</label>
          <select id="prof-patient-select" class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-300 focus:ring-1 focus:ring-violet-300">
            <option value="">-- Elige paciente --</option>
          </select>
        </div>
        <div id="prof-patient-calendar-wrap" class="hidden">
          <div class="mb-4 flex items-center justify-between">
            <h3 id="prof-patient-name" class="text-base font-semibold text-slate-700"></h3>
            <div class="flex items-center gap-2">
              <button id="prof-mood-prev" class="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">&larr;</button>
              <span id="prof-mood-title" class="min-w-[140px] text-center text-sm font-medium text-slate-700"></span>
              <button id="prof-mood-next" class="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">&rarr;</button>
            </div>
          </div>
          <div class="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
            <span>Lun</span><span>Mar</span><span>Mie</span><span>Jue</span><span>Vie</span><span>Sab</span><span>Dom</span>
          </div>
          <div id="prof-mood-grid" class="mt-1 grid grid-cols-7 gap-1"></div>
          <div id="prof-mood-detail" class="mt-3 hidden rounded-lg border border-violet-100 bg-violet-50/40 p-3 text-sm text-slate-700"></div>
          <div class="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span class="flex items-center gap-1"><span class="inline-block h-3 w-3 rounded bg-red-300"></span>1-2</span>
            <span class="flex items-center gap-1"><span class="inline-block h-3 w-3 rounded bg-orange-300"></span>3-4</span>
            <span class="flex items-center gap-1"><span class="inline-block h-3 w-3 rounded bg-yellow-300"></span>5-6</span>
            <span class="flex items-center gap-1"><span class="inline-block h-3 w-3 rounded bg-lime-300"></span>7-8</span>
            <span class="flex items-center gap-1"><span class="inline-block h-3 w-3 rounded bg-emerald-400"></span>9-10</span>
          </div>
        </div>
        <div id="prof-patient-empty" class="py-8 text-center text-sm text-slate-400">Selecciona un paciente para ver su historial emocional.</div>
      </section>
      <section id="view-chats" class="hidden rounded-2xl bg-white p-0 shadow-sm ring-1 ring-slate-200">
        <div class="grid min-h-[520px] md:grid-cols-[1fr_300px]">
          <div class="flex flex-col border-b border-slate-200 md:border-b-0 md:border-r">
            <div class="border-b border-slate-200 px-4 py-3">
              <p class="text-xs uppercase tracking-wide text-slate-500">Conversacion activa</p>
              <p id="prof-chat-active-name" class="text-sm font-semibold text-slate-800">Sin chat seleccionado</p>
            </div>
            <div id="prof-chat-thread" class="h-[380px] overflow-auto bg-slate-50 p-3 text-sm text-slate-700"></div>
            <div class="border-t border-slate-200 p-3">
              <textarea id="chat-prof-message" rows="2" placeholder="Escribe un mensaje..." class="w-full rounded border border-slate-200 px-3 py-2 text-sm"></textarea>
              <div class="mt-2 flex gap-2">
                <button id="send-prof-message" class="rounded bg-emerald-600 px-3 py-2 text-xs text-white">Enviar mensaje</button>
              </div>
            </div>
          </div>
          <aside class="p-3">
            <p class="mb-2 text-sm font-semibold text-slate-800">Contactos recientes</p>
            <div id="prof-chat-conversation-list" class="space-y-1"></div>
          </aside>
        </div>
      </section>
      <p id="prof-msg" class="mt-3 hidden rounded-lg border px-3 py-2 text-sm"></p>
    </main>
  `
  const msg = document.querySelector<HTMLParagraphElement>('#prof-msg')
  const showMsg = (text: string, ok: boolean) => {
    if (!msg) return
    msg.textContent = text
    msg.className = `fixed top-4 left-1/2 z-[9999] -translate-x-1/2 rounded-xl px-5 py-3 text-sm font-medium shadow-lg transition-all ${ok ? 'border border-green-200 bg-green-50 text-green-700' : 'border border-red-200 bg-red-50 text-red-700'}`
    msg.classList.remove('hidden')
    setTimeout(() => { msg.classList.add('hidden') }, 3500)
  }
  const today = new Date()
  let currentProfConversationId = 0
  let professionalConversations: Array<Record<string, string | number>> = []
  let selectedDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  let visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  let agendaDateRows: Array<Record<string, unknown>> = []
  let excepcionesRows: Array<{ fecha: string; solo_excepcion: boolean }> = []
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
  const dayNamesWeek = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo']
  const timeToMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map((v) => Number(v || 0))
    return h * 60 + m
  }

  const dateToISO = (date: Date) => {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  const datesWithFechaMarkers = (): Set<string> => {
    const s = new Set<string>()
    for (const row of agendaDateRows) {
      if (row.fecha) s.add(String(row.fecha))
    }
    for (const ex of excepcionesRows) {
      if (ex.fecha) s.add(ex.fecha)
    }
    return s
  }

  const syncExcepcionCheckbox = () => {
    const iso = dateToISO(selectedDate)
    const found = excepcionesRows.find((e) => e.fecha === iso)
    const cb = document.querySelector<HTMLInputElement>('#solo-este-dia-checkbox')
    if (!cb) return
    cb.checked = Boolean(found?.solo_excepcion)
  }

  const renderCalendar = () => {
    const title = document.querySelector<HTMLElement>('#calendar-title')
    const grid = document.querySelector<HTMLElement>('#calendar-grid')
    const selectedLabel = document.querySelector<HTMLElement>('#calendar-selected')
    if (!title || !grid || !selectedLabel) return

    title.textContent = `${monthNames[visibleMonth.getMonth()]} ${visibleMonth.getFullYear()}`
    selectedLabel.textContent = `Fecha elegida: ${dateToISO(selectedDate)}`

    const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1)
    const lastDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0)
    const startOffset = (firstDay.getDay() + 6) % 7
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const weekNames = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
    const cells: string[] = weekNames.map((w) => `<span class="text-center text-xs font-semibold text-slate-400">${w}</span>`)
    for (let i = 0; i < startOffset; i += 1) cells.push('<span></span>')
    const markers = datesWithFechaMarkers()

    for (let day = 1; day <= lastDay.getDate(); day += 1) {
      const cellDate = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day)
      const isPast = cellDate < todayMidnight
      const isSelected = dateToISO(cellDate) === dateToISO(selectedDate)
      const iso = dateToISO(cellDate)
      const dot = markers.has(iso) ? '<span class="mx-auto mt-0.5 block h-1 w-1 rounded-full bg-violet-500"></span>' : ''
      cells.push(`
        <button type="button" data-day="${day}" class="flex min-h-10 flex-col rounded px-1 py-1 text-center ${isSelected ? 'bg-violet-500 text-white' : 'bg-slate-50 text-slate-700'} ${isPast ? 'opacity-40 cursor-not-allowed' : 'hover:bg-violet-100'}" ${isPast ? 'disabled' : ''}>
          <span>${day}</span>
          ${dot}
        </button>
      `)
    }
    grid.innerHTML = cells.join('')
    grid.querySelectorAll<HTMLButtonElement>('button[data-day]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const day = Number(btn.dataset.day || 0)
        if (!day) return
        selectedDate = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day)
        renderCalendar()
        syncExcepcionCheckbox()
        renderDateAvailabilities(agendaDateRows)
      })
    })
  }

  const addPlantillaRow = (values?: Record<string, string | number | boolean>) => {
    const tbody = document.querySelector<HTMLTableSectionElement>('#plantilla-rows')
    if (!tbody) return
    const tr = document.createElement('tr')
    tr.className = 'border-b border-slate-100'
    tr.setAttribute('data-plantilla-row', '1')
    const dia = values?.dia_semana != null ? Number(values.dia_semana) : 0
    const hi = values?.hora_inicio != null ? String(values.hora_inicio) : '09:00'
    const hf = values?.hora_fin != null ? String(values.hora_fin) : '14:00'
    const activo = values?.activo != null ? Boolean(values.activo) : true
    const opts = dayNamesWeek
      .map((n, i) => `<option value="${i}" ${i === dia ? 'selected' : ''}>${n}</option>`)
      .join('')
    tr.innerHTML = `
      <td class="py-2 pr-2"><select data-field="dia_semana" class="w-full rounded border border-slate-200 px-1 py-1">${opts}</select></td>
      <td class="py-2 pr-2 text-center"><input data-field="activo" type="checkbox" ${activo ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300"/></td>
      <td class="py-2 pr-2"><input data-field="hora_inicio" type="time" value="${hi}" class="w-full rounded border border-slate-200 px-1 py-1" data-active-control="1"/></td>
      <td class="py-2 pr-2"><input data-field="hora_fin" type="time" value="${hf}" class="w-full rounded border border-slate-200 px-1 py-1" data-active-control="1"/></td>
      <td class="py-2"><button type="button" data-remove-plantilla class="text-xs text-rose-600 underline">Quitar</button></td>
    `
    tbody.appendChild(tr)
    const syncActiveState = () => {
      const checked = tr.querySelector<HTMLInputElement>('[data-field="activo"]')?.checked !== false
      tr.classList.toggle('opacity-60', !checked)
      tr.querySelectorAll<HTMLInputElement>('[data-active-control="1"]').forEach((node) => {
        node.disabled = !checked
      })
    }
    tr.querySelector<HTMLInputElement>('[data-field="activo"]')?.addEventListener('change', syncActiveState)
    syncActiveState()
    tr.querySelector<HTMLButtonElement>('[data-remove-plantilla]')?.addEventListener('click', () => {
      tr.remove()
      if (!tbody.querySelector('tr')) addPlantillaRow()
      renderSlotPreview()
    })
    tr.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((node) => {
      node.addEventListener('change', () => renderSlotPreview())
      node.addEventListener('input', () => renderSlotPreview())
    })
  }

  const renderPlantillaFromServer = (bloques: Array<Record<string, unknown>>) => {
    const tbody = document.querySelector<HTMLTableSectionElement>('#plantilla-rows')
    if (!tbody) return
    tbody.innerHTML = ''
    if (!bloques.length) {
      addPlantillaRow()
      return
    }
    for (const b of bloques) {
      addPlantillaRow(b as Record<string, string | number | boolean>)
    }
  }

  const collectPlantillaBloques = (): { bloques: Array<Record<string, string | number | boolean>>; error: string | null } => {
    const tbody = document.querySelector<HTMLTableSectionElement>('#plantilla-rows')
    if (!tbody) return { bloques: [], error: 'No se encontro la tabla de tramos' }
    const out: Array<Record<string, string | number | boolean>> = []
    let validationError: string | null = null
    const duracionGlobal = Number(document.querySelector<HTMLInputElement>('#pol-duracion-sesion')?.value || 0)
    const precioGlobal = Number(document.querySelector<HTMLInputElement>('#pol-precio-sesion')?.value || 0)
    if (duracionGlobal < 15 || duracionGlobal > 180) {
      return { bloques: [], error: 'La duracion global debe estar entre 15 y 180 minutos' }
    }
    if (precioGlobal < 0) {
      return { bloques: [], error: 'El precio global no puede ser negativo' }
    }
    tbody.querySelectorAll<HTMLTableRowElement>('tr[data-plantilla-row]').forEach((tr, idx) => {
      const hi = tr.querySelector<HTMLInputElement>('[data-field="hora_inicio"]')?.value || '09:00'
      const hf = tr.querySelector<HTMLInputElement>('[data-field="hora_fin"]')?.value || '14:00'
      const dm = duracionGlobal
      const activo = tr.querySelector<HTMLInputElement>('[data-field="activo"]')?.checked !== false
      if (activo && hf <= hi) {
        validationError = `Fila ${idx + 1}: la hora de fin debe ser mayor que la de inicio`
        return
      }
      if (activo && (timeToMin(hf) - timeToMin(hi) < dm)) {
        validationError = `Fila ${idx + 1}: el tramo debe cubrir al menos una sesion completa`
        return
      }
      const dia = Number(tr.querySelector<HTMLSelectElement>('[data-field="dia_semana"]')?.value ?? 0)
      tr.classList.remove('bg-rose-50')
      out.push({
        dia_semana: dia,
        hora_inicio: hi,
        hora_fin: hf,
        duracion_min: dm,
        precio: precioGlobal,
        activo,
      })
    })
    if (validationError) return { bloques: out, error: validationError }
    const activos = out.filter((b) => Boolean(b.activo))
    const grouped = new Map<number, Array<{ hi: number; hf: number }>>()
    for (const b of activos) {
      const dia = Number(b.dia_semana)
      const hi = timeToMin(String(b.hora_inicio))
      const hf = timeToMin(String(b.hora_fin))
      if (!grouped.has(dia)) grouped.set(dia, [])
      grouped.get(dia)?.push({ hi, hf })
    }
    for (const [dia, ranges] of grouped.entries()) {
      ranges.sort((a, b) => a.hi - b.hi)
      for (let i = 1; i < ranges.length; i += 1) {
        if (ranges[i].hi < ranges[i - 1].hf) {
          return { bloques: out, error: `Hay solapamiento de tramos en ${dayNamesWeek[dia]}` }
        }
      }
    }
    return { bloques: out, error: validationError }
  }

  const renderSlotPreview = () => {
    const summary = document.querySelector<HTMLElement>('#preview-summary')
    const slotsBox = document.querySelector<HTMLElement>('#preview-slots')
    const daySelect = document.querySelector<HTMLSelectElement>('#preview-day')
    if (!summary || !slotsBox || !daySelect) return
    const { bloques, error } = collectPlantillaBloques()
    if (error) {
      summary.textContent = `Error: ${error}`
      slotsBox.innerHTML = ''
      return
    }
    const selectedDay = Number(daySelect.value || 0)
    const descanso = Number(document.querySelector<HTMLInputElement>('#pol-descanso')?.value || 0)
    const diaBloques = bloques.filter((b) => Number(b.dia_semana) === selectedDay && Boolean(b.activo))
    const slots: string[] = []
    for (const block of diaBloques) {
      const hi = timeToMin(String(block.hora_inicio))
      const hf = timeToMin(String(block.hora_fin))
      const dm = Number(block.duracion_min || 50)
      const step = Math.max(5, dm + Math.max(0, descanso))
      for (let cursor = hi; cursor + dm <= hf; cursor += step) {
        const h = String(Math.floor(cursor / 60)).padStart(2, '0')
        const m = String(cursor % 60).padStart(2, '0')
        slots.push(`${h}:${m}`)
      }
    }
    const manana = slots.filter((s) => Number(s.split(':')[0]) < 14).length
    const tarde = slots.length - manana
    summary.textContent = slots.length
      ? `${dayNamesWeek[selectedDay]}: ${slots.length} huecos (${manana} manana + ${tarde} tarde)`
      : `${dayNamesWeek[selectedDay]}: no hay huecos generados`
    if (diaBloques.length > 0 && slots.length === 0) {
      summary.textContent += ' · Aviso: revisa duracion/tramos'
    }
    slotsBox.innerHTML = slots.length
      ? slots.map((s) => `<span class="rounded bg-white px-2 py-1 ring-1 ring-violet-200">${s}</span>`).join('')
      : '<span class="text-slate-500">Sin slots para este dia</span>'
  }
  const renderDateAvailabilities = (rows: Array<Record<string, unknown>>) => {
    const box = document.querySelector<HTMLElement>('#disp-fechas-list')
    const selectedBox = document.querySelector<HTMLElement>('#disp-fechas-selected-list')
    if (!box || !selectedBox) return
    const selectedIso = dateToISO(selectedDate)
    const selectedRows = rows.filter((row) => String(row.fecha) === selectedIso)

    selectedBox.innerHTML = selectedRows.map((row) => `
      <div class="flex items-center justify-between rounded border border-violet-200 bg-violet-50 px-2 py-1">
        <span>${row.hora_inicio}-${row.hora_fin} · ${row.duracion_min} min · ${row.precio} €</span>
        <button data-disp-id="${row.id}" class="rounded bg-rose-100 px-2 py-1 text-rose-700">Eliminar</button>
      </div>
    `).join('') || '<p class="text-slate-500">No hay tramos para esta fecha.</p>'

    box.innerHTML = rows.map((row) => `
      <div class="flex items-center justify-between rounded border border-slate-200 px-2 py-1">
        <span>${row.fecha} · ${row.hora_inicio}-${row.hora_fin} · ${row.duracion_min} min · ${row.precio} €</span>
        <button data-disp-id="${row.id}" class="rounded bg-rose-100 px-2 py-1 text-rose-700">Eliminar</button>
      </div>
    `).join('') || '<p class="text-slate-500">No hay disponibilidades por fecha.</p>'
    const deleteButtons = [
      ...box.querySelectorAll<HTMLButtonElement>('button[data-disp-id]'),
      ...selectedBox.querySelectorAll<HTMLButtonElement>('button[data-disp-id]'),
    ]
    deleteButtons.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.dispId
        if (!id) return
        const res = await fetch(`${API_BASE_URL}/profesionales/mi/disponibilidad-fecha/?id=${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) await load()
      })
    })
  }
  const renderAssignedAppointments = (rows: Array<Record<string, string | number>>) => {
    const box = document.querySelector<HTMLElement>('#prof-citas')
    if (!box) return
    box.innerHTML = rows.map((c) => `
      <div class="rounded-lg border border-slate-200 p-3">
        <div class="flex items-center justify-between">
          <p class="font-medium">${new Date(String(c.fecha_hora)).toLocaleString()}</p>
          <span class="text-xs text-slate-500">${c.estado}</span>
        </div>
        <p class="text-slate-600">${c.paciente_nombre}</p>
        <p class="text-xs text-slate-500">${c.duracion_min || '-'} min</p>
        <div class="mt-1 flex gap-2">
          <button data-id="${c.id}" data-status="confirmada" class="rounded bg-emerald-100 px-2 py-1 text-xs">Confirmar</button>
          <button data-id="${c.id}" data-status="cancelada" class="rounded bg-rose-100 px-2 py-1 text-xs text-rose-700">Borrar cita</button>
        </div>
      </div>
    `).join('') || '<p class="text-slate-500">No hay citas.</p>'
    box.querySelectorAll<HTMLButtonElement>('button[data-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id
        const status = btn.dataset.status
        if (!id || !status) return
        const res = await fetch(`${API_BASE_URL}/citas/${id}/estado/`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ estado: status }),
        })
        const body = await res.json()
        showMsg(res.ok ? 'Cita eliminada del listado' : body.detail || 'No se pudo actualizar la cita', res.ok)
        await load()
      })
    })
  }
  const loadProfessionalConversationMessages = async () => {
    const thread = document.querySelector<HTMLElement>('#prof-chat-thread')
    const activeName = document.querySelector<HTMLElement>('#prof-chat-active-name')
    if (!thread) return
    if (!currentProfConversationId) {
      thread.innerHTML = '<p>Selecciona una conversacion para empezar.</p>'
      if (activeName) activeName.textContent = 'Sin chat seleccionado'
      return
    }
    const currentConv = professionalConversations.find((c) => Number(c.id) === currentProfConversationId)
    if (activeName) activeName.textContent = String(currentConv?.paciente_nombre || 'Paciente')
    const res = await fetch(`${API_BASE_URL}/chat/conversaciones/${currentProfConversationId}/mensajes/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = await res.json()
    if (!res.ok) {
      thread.innerHTML = `<p>${body.detail || 'No se pudo cargar chat'}</p>`
      return
    }
    const messages = body.mensajes || []
    thread.innerHTML = messages
      .map((m: Record<string, string>) => {
        const mine = m.emisor === 'profesional'
        const timeLabel = m.fecha_envio
          ? new Date(String(m.fecha_envio)).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
          : ''
        return `<div class="mb-2 flex ${mine ? 'justify-end' : 'justify-start'}">
          <div class="max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${mine ? 'bg-violet-500 text-white rounded-br-md' : 'bg-white text-slate-800 border border-slate-200 rounded-bl-md'}">
            <p class="whitespace-pre-wrap break-words">${String(m.contenido || '')}</p>
            <p class="mt-1 text-[11px] ${mine ? 'text-violet-100' : 'text-slate-400'}">${timeLabel}</p>
          </div>
        </div>`
      })
      .join('') || '<p class="text-sm text-slate-500">Sin mensajes</p>'
    thread.scrollTop = thread.scrollHeight
  }
  const renderProfessionalConversations = () => {
    const box = document.querySelector<HTMLElement>('#prof-chat-conversation-list')
    if (!box) return
    if (!professionalConversations.length) {
      box.innerHTML = '<p class="text-xs text-slate-500">Sin conversaciones activas.</p>'
      return
    }
    box.innerHTML = professionalConversations
      .map((c) => {
        const id = Number(c.id || 0)
        const selected = id === currentProfConversationId
        const lastMov = c.ultimo_movimiento ? new Date(String(c.ultimo_movimiento)).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : ''
        return `<button type="button" data-prof-chat-conv-id="${id}" class="w-full rounded border px-2 py-2 text-left text-xs ${selected ? 'border-violet-300 bg-violet-50 text-violet-800' : 'border-slate-200 bg-white text-slate-700'}">
          <p class="font-medium">${String(c.paciente_nombre || 'Paciente')}</p>
          <p class="text-[11px] text-slate-500">${lastMov}</p>
        </button>`
      })
      .join('')
    box.querySelectorAll<HTMLButtonElement>('button[data-prof-chat-conv-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        currentProfConversationId = Number(btn.dataset.profChatConvId || 0)
        renderProfessionalConversations()
        await loadProfessionalConversationMessages()
      })
    })
  }
  const loadProfessionalConversations = async () => {
    const res = await fetch(`${API_BASE_URL}/chat/conversaciones/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = await res.json()
    if (!res.ok) return
    professionalConversations = (body.conversaciones || [])
      .sort((a: Record<string, string | number>, b: Record<string, string | number>) =>
        String(b.ultimo_movimiento || '').localeCompare(String(a.ultimo_movimiento || '')),
      )
    if (!currentProfConversationId && professionalConversations.length) {
      currentProfConversationId = Number(professionalConversations[0].id || 0)
    }
    renderProfessionalConversations()
  }
  const load = async () => {
    const meRes = await fetch(`${API_BASE_URL}/auth/me/`, { headers: { Authorization: `Bearer ${token}` } })
    const me = await meRes.json()
    if (!meRes.ok || me.rol !== 'profesional') {
      window.location.href = '/mindlink-trabajador'
      return
    }
    const agendaRes = await fetch(`${API_BASE_URL}/profesionales/mi/agenda/`, { headers: { Authorization: `Bearer ${token}` } })
    const agendaBody = await agendaRes.json()
    agendaDateRows = agendaBody.agenda_fechas || []
    excepcionesRows = (agendaBody.excepciones_fecha || []).map((r: Record<string, unknown>) => ({
      fecha: String(r.fecha),
      solo_excepcion: Boolean(r.solo_excepcion),
    }))
    renderPlantillaFromServer(agendaBody.agenda_semanal || [])
    renderCalendar()
    syncExcepcionCheckbox()
    renderDateAvailabilities(agendaDateRows)
    const p = agendaBody.politicas || {}
    ;(document.querySelector<HTMLInputElement>('#pol-antelacion') as HTMLInputElement | null)?.setAttribute('value', String(p.antelacion_minima_minutos ?? 30))
    ;(document.querySelector<HTMLInputElement>('#pol-horizonte') as HTMLInputElement | null)?.setAttribute('value', String(p.horizonte_maximo_dias ?? 90))
    ;(document.querySelector<HTMLInputElement>('#pol-descanso') as HTMLInputElement | null)?.setAttribute('value', String(p.descanso_entre_citas_minutos ?? 0))
    const polAnt = document.querySelector<HTMLInputElement>('#pol-antelacion')
    const polHor = document.querySelector<HTMLInputElement>('#pol-horizonte')
    const polDes = document.querySelector<HTMLInputElement>('#pol-descanso')
    const polDur = document.querySelector<HTMLInputElement>('#pol-duracion-sesion')
    const polPre = document.querySelector<HTMLInputElement>('#pol-precio-sesion')
    const firstActiveBlock = (agendaBody.agenda_semanal || []).find((b: Record<string, unknown>) => Boolean(b.activo))
    if (polAnt) polAnt.value = String(p.antelacion_minima_minutos ?? 30)
    if (polHor) polHor.value = String(p.horizonte_maximo_dias ?? 90)
    if (polDes) polDes.value = String(p.descanso_entre_citas_minutos ?? 0)
    if (polDur) polDur.value = String(firstActiveBlock?.duracion_min ?? 50)
    if (polPre) polPre.value = String(firstActiveBlock?.precio ?? 50)
    renderSlotPreview()

    const citasRes = await fetch(`${API_BASE_URL}/citas/`, { headers: { Authorization: `Bearer ${token}` } })
    const citasBody = await citasRes.json()
    const citasList = citasBody.citas || []
    renderAssignedAppointments(citasList)
    populatePatientSelect(citasList)
    await loadProfessionalConversations()
    await loadProfessionalConversationMessages()
  }

  const showAgendaSub = (which: 'plantilla' | 'fecha') => {
    const pPlant = document.querySelector<HTMLElement>('#panel-plantilla')
    const pFecha = document.querySelector<HTMLElement>('#panel-fecha')
    const bPl = document.querySelector<HTMLButtonElement>('#sub-agenda-plantilla')
    const bFe = document.querySelector<HTMLButtonElement>('#sub-agenda-fecha')
    if (!pPlant || !pFecha || !bPl || !bFe) return
    pPlant.classList.toggle('hidden', which !== 'plantilla')
    pFecha.classList.toggle('hidden', which !== 'fecha')
    const inactive = 'rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300'
    const active = 'rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white'
    bPl.className = which === 'plantilla' ? active : inactive
    bFe.className = which === 'fecha' ? active : inactive
    if (which === 'fecha') {
      renderCalendar()
      syncExcepcionCheckbox()
    }
  }

  document.querySelector<HTMLButtonElement>('#sub-agenda-plantilla')?.addEventListener('click', () => showAgendaSub('plantilla'))
  document.querySelector<HTMLButtonElement>('#sub-agenda-fecha')?.addEventListener('click', () => showAgendaSub('fecha'))

  document.querySelector<HTMLButtonElement>('#plantilla-add-row')?.addEventListener('click', () => addPlantillaRow())
  document.querySelector<HTMLSelectElement>('#preview-day')?.addEventListener('change', () => renderSlotPreview())
  document.querySelectorAll<HTMLInputElement>('#pol-descanso, #pol-duracion-sesion, #pol-precio-sesion').forEach((node) => {
    node.addEventListener('input', () => renderSlotPreview())
    node.addEventListener('change', () => renderSlotPreview())
  })

  document.querySelector<HTMLButtonElement>('#save-plantilla')?.addEventListener('click', async () => {
    const validationNode = document.querySelector<HTMLParagraphElement>('#plantilla-validation')
    const { bloques, error } = collectPlantillaBloques()
    if (validationNode) {
      validationNode.classList.add('hidden')
      validationNode.textContent = ''
    }
    if (error) {
      if (validationNode) {
        validationNode.textContent = error
        validationNode.className = 'mb-3 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700'
      }
      showMsg(error, false)
      return
    }
    if (!bloques.length) {
      showMsg('Anade al menos un tramo valido (hora hasta mayor que hora desde).', false)
      return
    }
    const res = await fetch(`${API_BASE_URL}/profesionales/mi/agenda/`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bloques }),
    })
    const body = await res.json()
    if (!res.ok) {
      showMsg(body.detail || 'No se pudo guardar la plantilla', false)
      return
    }
    showMsg('Horario guardado correctamente', true)
    await load()
  })

  document.querySelector<HTMLButtonElement>('#save-politicas')?.addEventListener('click', async () => {
    const antelacion = Number(document.querySelector<HTMLInputElement>('#pol-antelacion')?.value || 0)
    const horizonte = Number(document.querySelector<HTMLInputElement>('#pol-horizonte')?.value || 0)
    const descanso = Number(document.querySelector<HTMLInputElement>('#pol-descanso')?.value || 0)
    const duracionSesion = Number(document.querySelector<HTMLInputElement>('#pol-duracion-sesion')?.value || 50)
    const { bloques } = collectPlantillaBloques()
    const firstActive = bloques.find((b) => Boolean(b.activo))
    const granularidad = duracionSesion > 0 ? duracionSesion : Number(firstActive?.duracion_min || 5)
    const res = await fetch(`${API_BASE_URL}/profesionales/mi/agenda-politicas/`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        antelacion_minima_minutos: antelacion,
        horizonte_maximo_dias: horizonte,
        descanso_entre_citas_minutos: descanso,
        granularidad_minutos: granularidad,
      }),
    })
    const body = await res.json()
    if (!res.ok) {
      showMsg(body.detail || 'No se pudieron guardar las politicas', false)
      return
    }
    showMsg('Politicas de reserva actualizadas', true)
    await load()
  })

  const postExcepcionDesdeCheckbox = async () => {
    const fecha = dateToISO(selectedDate)
    const soloExc = document.querySelector<HTMLInputElement>('#solo-este-dia-checkbox')?.checked === true
    const res = await fetch(`${API_BASE_URL}/profesionales/mi/excepcion-dia/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fecha, solo_excepcion: soloExc }),
    })
    const body = await res.json()
    if (!res.ok) {
      showMsg(body.detail || 'No se pudo guardar el modo del dia', false)
      return
    }
    await load()
  }

  document.querySelector<HTMLInputElement>('#solo-este-dia-checkbox')?.addEventListener('change', () => {
    void postExcepcionDesdeCheckbox()
  })

  document.querySelector<HTMLButtonElement>('#clear-excepcion-dia')?.addEventListener('click', async () => {
    const fecha = dateToISO(selectedDate)
    const res = await fetch(`${API_BASE_URL}/profesionales/mi/excepcion-dia/?fecha=${encodeURIComponent(fecha)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) await load()
  })

  document.querySelector<HTMLButtonElement>('#calendar-prev')?.addEventListener('click', () => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1)
    renderCalendar()
    syncExcepcionCheckbox()
  })
  document.querySelector<HTMLButtonElement>('#calendar-next')?.addEventListener('click', () => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1)
    renderCalendar()
    syncExcepcionCheckbox()
  })

  document.querySelector<HTMLButtonElement>('#add-disp-fecha')?.addEventListener('click', async () => {
    const fecha = dateToISO(selectedDate)
    const horaInicio = document.querySelector<HTMLInputElement>('#disp-inicio')?.value || ''
    const horaFin = document.querySelector<HTMLInputElement>('#disp-fin')?.value || ''
    const duracionMin = Number(document.querySelector<HTMLInputElement>('#pol-duracion-sesion')?.value || 0)
    const precio = Number(document.querySelector<HTMLInputElement>('#pol-precio-sesion')?.value || 0)
    const soloEsteDiaMarcado = document.querySelector<HTMLInputElement>('#solo-este-dia-checkbox')?.checked === true
    const payload: Record<string, string | number | boolean> = {
      fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      duracion_min: duracionMin,
      precio,
      activo: true,
      solo_este_dia: soloEsteDiaMarcado,
    }

    const res = await fetch(`${API_BASE_URL}/profesionales/mi/disponibilidad-fecha/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.json()
    if (!res.ok) {
      showMsg(body.detail || 'No se pudo anadir la disponibilidad', false)
      return
    }
    showMsg('Tramo anadido', true)
    await load()
  })

  document.querySelector<HTMLButtonElement>('#logout-prof')?.addEventListener('click', () => {
    localStorage.removeItem('mindlink_token')
    localStorage.removeItem('mindlink_user')
    window.location.href = '/mindlink-trabajador'
  })
  const agendaTab = document.querySelector<HTMLButtonElement>('#tab-agenda')
  const citasTab = document.querySelector<HTMLButtonElement>('#tab-citas')
  const pacientesTab = document.querySelector<HTMLButtonElement>('#tab-pacientes')
  const chatsTab = document.querySelector<HTMLButtonElement>('#tab-chats')
  const agendaView = document.querySelector<HTMLElement>('#view-agenda')
  const citasView = document.querySelector<HTMLElement>('#view-citas')
  const pacientesView = document.querySelector<HTMLElement>('#view-pacientes')
  const chatsView = document.querySelector<HTMLElement>('#view-chats')
  const activeTabClass = 'rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white'
  const inactiveTabClass = 'rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300'
  const allTabs = [agendaTab, citasTab, pacientesTab, chatsTab]
  const allViews = [agendaView, citasView, pacientesView, chatsView]
  const showProfSection = (idx: number) => {
    allViews.forEach((v, i) => v?.classList.toggle('hidden', i !== idx))
    allTabs.forEach((t, i) => { if (t) t.className = i === idx ? activeTabClass : inactiveTabClass })
  }
  const showAgenda = () => showProfSection(0)
  const showCitas = () => showProfSection(1)
  const showPacientes = () => showProfSection(2)
  const showChats = () => showProfSection(3)
  agendaTab?.addEventListener('click', showAgenda)
  citasTab?.addEventListener('click', showCitas)
  pacientesTab?.addEventListener('click', showPacientes)
  chatsTab?.addEventListener('click', showChats)

  // --- Patient emotional tracking (professional view) ---
  type ProfEmoRecord = { id: number; fecha: string; emocion: string; intensidad: number; nota?: string }
  let profPatientRecords: ProfEmoRecord[] = []
  let profMoodMonth = new Date().getMonth()
  let profMoodYear = new Date().getFullYear()
  let profMoodSelectedDate = ''
  const profPatientSelect = document.querySelector<HTMLSelectElement>('#prof-patient-select')
  const profCalWrap = document.querySelector<HTMLElement>('#prof-patient-calendar-wrap')
  const profEmpty = document.querySelector<HTMLElement>('#prof-patient-empty')

  const profIntensityColor = (val: number): string => {
    if (val <= 2) return 'bg-red-300'
    if (val <= 4) return 'bg-orange-300'
    if (val <= 6) return 'bg-yellow-300'
    if (val <= 8) return 'bg-lime-300'
    return 'bg-emerald-400'
  }
  const profMonthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

  const renderProfMoodCalendar = () => {
    const grid = document.querySelector<HTMLElement>('#prof-mood-grid')
    const title = document.querySelector<HTMLElement>('#prof-mood-title')
    const detail = document.querySelector<HTMLElement>('#prof-mood-detail')
    if (!grid || !title) return
    title.textContent = `${profMonthNames[profMoodMonth]} ${profMoodYear}`

    const firstDay = new Date(profMoodYear, profMoodMonth, 1)
    const lastDay = new Date(profMoodYear, profMoodMonth + 1, 0)
    let startDow = firstDay.getDay() - 1
    if (startDow < 0) startDow = 6

    const recordsByDate = new Map<string, ProfEmoRecord[]>()
    for (const r of profPatientRecords) {
      const d = r.fecha.slice(0, 10)
      if (!recordsByDate.has(d)) recordsByDate.set(d, [])
      recordsByDate.get(d)!.push(r)
    }

    let html = ''
    for (let i = 0; i < startDow; i++) html += '<div class="h-10"></div>'
    const today = formatLocalDateISO(new Date())
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const dateStr = `${profMoodYear}-${String(profMoodMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const entries = recordsByDate.get(dateStr) || []
      const isToday = dateStr === today
      const avg = entries.length > 0 ? Math.round(entries.reduce((s, e) => s + e.intensidad, 0) / entries.length) : 0
      const colorCls = avg > 0 ? profIntensityColor(avg) : 'bg-slate-100'
      const todayRing = isToday ? 'ring-2 ring-violet-400' : ''
      const cursor = entries.length > 0 ? 'cursor-pointer hover:scale-110' : ''
      html += `<button data-prof-cal-date="${dateStr}" class="prof-mood-day flex h-10 w-full items-center justify-center rounded-lg text-xs font-medium text-slate-700 transition ${colorCls} ${todayRing} ${cursor}">${day}</button>`
    }
    grid.innerHTML = html

    const showProfDetail = (dateStr: string) => {
      if (!detail) return
      const entries = recordsByDate.get(dateStr) || []
      if (!entries.length) { detail.classList.add('hidden'); profMoodSelectedDate = ''; return }
      profMoodSelectedDate = dateStr
      detail.classList.remove('hidden')
      detail.innerHTML = `<p class="mb-2 font-medium text-violet-800">${new Date(dateStr + 'T12:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</p>` +
        entries.map((e) => {
          const notaHtml = e.nota ? `<p class="mt-1 rounded bg-white/70 px-2 py-1 text-xs text-slate-600 italic">${e.nota}</p>` : ''
          return `<div class="mb-2 last:mb-0"><p class="flex items-center gap-2"><span class="inline-block h-2.5 w-2.5 rounded-full ${profIntensityColor(e.intensidad)}"></span><span class="font-medium text-slate-700">${e.intensidad}/10</span> <span class="text-slate-400">&middot;</span> <span class="capitalize text-slate-500">${e.emocion}</span></p>${notaHtml}</div>`
        }).join('')
    }

    if (profMoodSelectedDate) showProfDetail(profMoodSelectedDate)
    else if (detail) detail.classList.add('hidden')

    grid.querySelectorAll<HTMLButtonElement>('.prof-mood-day').forEach((btn) => {
      btn.addEventListener('click', () => showProfDetail(btn.dataset.profCalDate || ''))
    })
  }

  const loadPatientEmotions = async (pacienteId: number) => {
    profPatientRecords = []
    profMoodSelectedDate = ''
    const res = await fetch(`${API_BASE_URL}/emociones/?paciente_id=${pacienteId}`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      const body = await res.json()
      profPatientRecords = body.registros || []
    }
    renderProfMoodCalendar()
  }

  const populatePatientSelect = (citas: Array<Record<string, string | number>>) => {
    if (!profPatientSelect) return
    const seen = new Map<number, string>()
    for (const c of citas) {
      const id = Number(c.paciente_id || 0)
      const name = String(c.paciente_nombre || '')
      if (id && !seen.has(id)) seen.set(id, name)
    }
    const opts = Array.from(seen.entries()).map(([id, name]) => `<option value="${id}">${name}</option>`)
    profPatientSelect.innerHTML = '<option value="">-- Elige paciente --</option>' + opts.join('')
  }

  profPatientSelect?.addEventListener('change', async () => {
    const id = Number(profPatientSelect.value)
    if (!id) {
      if (profCalWrap) profCalWrap.classList.add('hidden')
      if (profEmpty) profEmpty.classList.remove('hidden')
      return
    }
    if (profEmpty) profEmpty.classList.add('hidden')
    if (profCalWrap) profCalWrap.classList.remove('hidden')
    const nameEl = document.querySelector<HTMLElement>('#prof-patient-name')
    const selectedOpt = profPatientSelect.options[profPatientSelect.selectedIndex]
    if (nameEl) nameEl.textContent = selectedOpt?.textContent || ''
    await loadPatientEmotions(id)
  })

  document.querySelector<HTMLButtonElement>('#prof-mood-prev')?.addEventListener('click', () => {
    profMoodMonth--
    if (profMoodMonth < 0) { profMoodMonth = 11; profMoodYear-- }
    renderProfMoodCalendar()
  })
  document.querySelector<HTMLButtonElement>('#prof-mood-next')?.addEventListener('click', () => {
    profMoodMonth++
    if (profMoodMonth > 11) { profMoodMonth = 0; profMoodYear++ }
    renderProfMoodCalendar()
  })

  document.querySelector<HTMLButtonElement>('#load-trend')?.addEventListener('click', async () => {
    const pacienteId = Number(document.querySelector<HTMLInputElement>('#trend-paciente-id')?.value || 0)
    if (!pacienteId) return
    const res = await fetch(`${API_BASE_URL}/emociones/tendencia/?paciente_id=${pacienteId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = await res.json()
    const target = document.querySelector<HTMLElement>('#trend-result')
    if (!target) return
    if (!res.ok) {
      target.textContent = body.detail || 'No se pudo cargar tendencia'
      return
    }
    target.textContent = `Promedio intensidad: ${body.promedio_intensidad} / Total registros: ${body.total}`
  })
  document.querySelector<HTMLButtonElement>('#send-prof-message')?.addEventListener('click', async () => {
    const contenido = document.querySelector<HTMLTextAreaElement>('#chat-prof-message')?.value || ''
    if (!currentProfConversationId || !contenido) {
      showMsg('Selecciona una conversacion y escribe mensaje', false)
      return
    }
    const msgRes = await fetch(`${API_BASE_URL}/chat/conversaciones/${currentProfConversationId}/mensajes/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contenido }),
    })
    const msgBody = await msgRes.json()
    showMsg(msgRes.ok ? 'Mensaje enviado a paciente' : msgBody.detail || 'No se pudo enviar', msgRes.ok)
    if (msgRes.ok) {
      const input = document.querySelector<HTMLTextAreaElement>('#chat-prof-message')
      if (input) input.value = ''
      await loadProfessionalConversations()
      await loadProfessionalConversationMessages()
    }
  })
  document.querySelector<HTMLTextAreaElement>('#chat-prof-message')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      document.querySelector<HTMLButtonElement>('#send-prof-message')?.click()
    }
  })
  const professionalChatPollWindow = window as Window & { __mindlinkProfessionalChatPoll?: number }
  if (professionalChatPollWindow.__mindlinkProfessionalChatPoll) {
    window.clearInterval(professionalChatPollWindow.__mindlinkProfessionalChatPoll)
  }
  professionalChatPollWindow.__mindlinkProfessionalChatPoll = window.setInterval(async () => {
    await loadProfessionalConversations()
    await loadProfessionalConversationMessages()
  }, 4000)
  const professionalPanelPollWindow = window as Window & { __mindlinkProfessionalPanelPoll?: number }
  if (professionalPanelPollWindow.__mindlinkProfessionalPanelPoll) {
    window.clearInterval(professionalPanelPollWindow.__mindlinkProfessionalPanelPoll)
    professionalPanelPollWindow.__mindlinkProfessionalPanelPoll = undefined
  }
  showAgenda()
  showAgendaSub('plantilla')
  await load()
}

function render(mode: AuthMode = 'login', portal: PortalType = detectPortal()): void {
  const loginActive = mode === 'login'
  const registerPacienteActive = mode === 'register-paciente'
  const registerProfesionalActive = mode === 'register-profesional'
  const isRegisterMode = registerPacienteActive || registerProfesionalActive
  const selectedRole = registerPacienteActive ? 'paciente' : 'profesional'
  const isPortalUsuario = portal === 'usuario'
  const isPortalTrabajador = portal === 'trabajador'
  const isPortalAdmin = portal === 'admin'
  const portalTitle = isPortalUsuario
    ? 'Portal de pacientes'
    : isPortalTrabajador
      ? 'Portal de profesionales'
      : 'Portal de administracion'
  const portalDescription = isPortalUsuario
    ? 'Accede como usuario para iniciar tu seguimiento emocional.'
    : isPortalTrabajador
      ? 'Accede como profesional para gestionar pacientes, citas y seguimiento.'
      : 'Accede como administrador para supervisar usuarios y configuracion.'

  app.innerHTML = `
    <main class="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-4 py-6 sm:py-10">
      <section class="grid w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-[0_20px_60px_-24px_rgba(124,58,237,0.35)] md:grid-cols-2">
        <aside class="hidden flex-col justify-between bg-gradient-to-br from-[#C4B5FD] via-[#DDD6FE] to-[#E0F2FE] p-10 text-slate-700 md:flex">
          <div>
            <div class="inline-flex rounded-full bg-white/70 px-4 py-2">${BRAND_LOGO_HERO}</div>
            <h1 class="mt-6 text-3xl font-semibold leading-tight">${portalTitle}</h1>
            <p class="mt-4 text-sm leading-6 text-slate-600">${portalDescription}</p>
          </div>
          <ul class="space-y-2 text-sm text-slate-600">
            <li>- Registro emocional diario</li>
            <li>- Comunicacion paciente-profesional</li>
            <li>- Gestion de citas y seguimiento</li>
          </ul>
        </aside>

        <div class="p-6 sm:p-10">
          <!-- Header solo visible en movil -->
          <div class="mb-6 flex flex-col items-center text-center md:hidden">
            <div class="mb-3 inline-flex rounded-full bg-gradient-to-br from-violet-100 to-indigo-50 px-5 py-2.5 shadow-sm">${BRAND_LOGO_HERO}</div>
            <h1 class="text-xl font-bold text-slate-800">${portalTitle}</h1>
            <p class="mt-1 text-xs text-slate-500">${portalDescription}</p>
          </div>
          <div class="mb-5 grid ${isPortalAdmin ? 'grid-cols-1' : 'grid-cols-2'} rounded-xl bg-[#F2EEFF] p-1 text-xs sm:text-sm font-medium">
            <button id="tab-login" class="rounded-lg px-3 py-2.5 transition ${loginActive ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-600'}">Iniciar sesion</button>
            ${
              isPortalAdmin
                ? ''
                : isPortalUsuario
                  ? `<button id="tab-register-paciente" class="rounded-lg px-3 py-2.5 transition ${registerPacienteActive ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-600'}">Crear cuenta</button>`
                  : `<button id="tab-register-profesional" class="rounded-lg px-3 py-2.5 transition ${registerProfesionalActive ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-600'}">Crear cuenta</button>`
            }
          </div>

          <p class="mb-3 text-center text-[11px] text-slate-400">
            ${
              isPortalUsuario
                ? `¿Eres profesional? <a class="font-medium text-violet-600 hover:underline" href="/mindlink-trabajador">Accede aqui</a>`
                : isPortalTrabajador
                  ? `¿Eres paciente? <a class="font-medium text-violet-600 hover:underline" href="/mindlink">Accede aqui</a>`
                  : `Otros portales: <a class="font-medium text-violet-600 hover:underline" href="/mindlink">Pacientes</a> · <a class="font-medium text-violet-600 hover:underline" href="/mindlink-trabajador">Profesionales</a>`
            }
          </p>

          <p id="global-message" class="mb-4 hidden rounded-lg border px-3 py-2 text-sm"></p>

          <form id="auth-form" class="space-y-3">
            <div>
              <label class="mb-1 block text-xs sm:text-sm font-medium text-slate-700">Email</label>
              <input name="email" type="email" required class="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none ring-violet-200 transition focus:border-violet-300 focus:ring" placeholder="tu@email.com"/>
            </div>

            <div ${isRegisterMode ? '' : 'class="hidden"'}>
              <label class="mb-1 block text-xs sm:text-sm font-medium text-slate-700">Nombre completo</label>
              <input name="nombre" ${isRegisterMode ? 'required' : ''} class="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none ring-violet-200 transition focus:border-violet-300 focus:ring" placeholder="Tu nombre"/>
            </div>

            <div ${isRegisterMode ? 'class="grid grid-cols-2 gap-2"' : 'class="hidden"'}>
              <div>
                <label class="mb-1 block text-xs sm:text-sm font-medium text-slate-700">Telefono</label>
                <input name="telefono" ${isRegisterMode ? 'required' : ''} class="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none ring-violet-200 transition focus:border-violet-300 focus:ring" placeholder="600123123"/>
              </div>
              <div>
                <label class="mb-1 block text-xs sm:text-sm font-medium text-slate-700">DNI</label>
                <input name="dni" ${isRegisterMode ? 'required' : ''} class="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm uppercase outline-none ring-violet-200 transition focus:border-violet-300 focus:ring" placeholder="12345678A"/>
              </div>
            </div>

            <div ${isRegisterMode ? '' : 'class="hidden"'}>
              <label class="mb-1 block text-xs sm:text-sm font-medium text-slate-700">Ciudad de residencia</label>
              <input name="ciudad_residencia" ${isRegisterMode ? 'required' : ''} class="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none ring-violet-200 transition focus:border-violet-300 focus:ring" placeholder="Madrid"/>
            </div>

            <div>
              <label class="mb-1 block text-xs sm:text-sm font-medium text-slate-700">Contrasena</label>
              <input name="contrasena" type="password" required class="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none ring-violet-200 transition focus:border-violet-300 focus:ring" placeholder="Minimo 8 caracteres"/>
            </div>

            <div ${registerPacienteActive ? '' : 'class="hidden"'}>
              <label class="mb-1 block text-xs sm:text-sm font-medium text-slate-700">Fecha de nacimiento</label>
              <input name="fecha_nacimiento" type="date" ${registerPacienteActive ? 'required' : ''} class="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none ring-violet-200 transition focus:border-violet-300 focus:ring"/>
            </div>

            <div ${registerProfesionalActive ? '' : 'class="hidden"'}>
              <label class="mb-1 block text-xs sm:text-sm font-medium text-slate-700">Especialidad</label>
              <input name="especialidad" ${registerProfesionalActive ? 'required' : ''} class="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none ring-violet-200 transition focus:border-violet-300 focus:ring" placeholder="Psicologia clinica"/>
            </div>

            <button id="submit-button" type="submit" class="mt-2 w-full rounded-xl bg-gradient-to-r from-violet-500 to-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-violet-200 transition hover:from-violet-600 hover:to-indigo-600 active:scale-[0.98]">
              ${loginActive ? 'Iniciar sesion' : `Crear cuenta`}
            </button>
          </form>

          <section id="session-box" class="mt-8 hidden rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <h2 class="mb-2 font-semibold text-slate-700">Sesion actual</h2>
            <p><span class="font-medium">Usuario:</span> <span id="session-email">-</span></p>
            <p><span class="font-medium">Rol:</span> <span id="session-role">-</span></p>
            <p><span class="font-medium">Pantalla sugerida:</span> <span id="session-panel">-</span></p>
            <button id="logout-button" class="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-300">Cerrar sesion</button>
          </section>
        </div>
      </section>
    </main>
  `

  const form = document.querySelector<HTMLFormElement>('#auth-form')
  const tabLogin = document.querySelector<HTMLButtonElement>('#tab-login')
  const tabRegisterPaciente = document.querySelector<HTMLButtonElement>('#tab-register-paciente')
  const tabRegisterProfesional = document.querySelector<HTMLButtonElement>('#tab-register-profesional')
  const submitButton = document.querySelector<HTMLButtonElement>('#submit-button')
  const globalMessage = document.querySelector<HTMLParagraphElement>('#global-message')
  const sessionBox = document.querySelector<HTMLElement>('#session-box')
  const sessionEmail = document.querySelector<HTMLSpanElement>('#session-email')
  const sessionRole = document.querySelector<HTMLSpanElement>('#session-role')
  const sessionPanel = document.querySelector<HTMLSpanElement>('#session-panel')
  const logoutButton = document.querySelector<HTMLButtonElement>('#logout-button')

  if (!form || !tabLogin || !submitButton || !globalMessage) return

  tabLogin.addEventListener('click', (event) => {
    event.preventDefault()
    render('login', portal)
  })

  tabRegisterPaciente?.addEventListener('click', (event) => {
    event.preventDefault()
    render('register-paciente', portal)
  })

  tabRegisterProfesional?.addEventListener('click', (event) => {
    event.preventDefault()
    render('register-profesional', portal)
  })

  logoutButton?.addEventListener('click', () => {
    localStorage.removeItem('mindlink_token')
    localStorage.removeItem('mindlink_user')
    render('login', portal)
  })

  const showMessage = (text: string, type: 'ok' | 'error') => {
    globalMessage.textContent = text
    globalMessage.classList.remove('hidden', 'border-green-200', 'bg-green-50', 'text-green-700', 'border-red-200', 'bg-red-50', 'text-red-700')
    if (type === 'ok') {
      globalMessage.classList.add('border-green-200', 'bg-green-50', 'text-green-700')
      return
    }
    globalMessage.classList.add('border-red-200', 'bg-red-50', 'text-red-700')
  }

  const refreshSession = async () => {
    const token = localStorage.getItem('mindlink_token')
    if (!token || !sessionBox || !sessionEmail || !sessionRole || !sessionPanel) return

    try {
      const response = await fetch(`${API_BASE_URL}/auth/me/`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const body = await response.json()

      if (!response.ok) {
        hideTransitionOverlay()
        localStorage.removeItem('mindlink_token')
        localStorage.removeItem('mindlink_user')
        return
      }

      sessionBox.classList.remove('hidden')
      sessionEmail.textContent = body.email
      sessionRole.textContent = body.rol
      sessionPanel.textContent = roleLabel[body.rol] || getRolePanelPath(body.rol)

      const rolePortal = getPortalByRole(body.rol)
      if (rolePortal !== portal) {
        hideTransitionOverlay()
        localStorage.removeItem('mindlink_token')
        localStorage.removeItem('mindlink_user')
        showMessage('Esta cuenta no puede iniciar sesion en este portal. Usa su acceso correspondiente.', 'error')
        return
      }

      showMessage('Sesion detectada. Redirigiendo a tu panel...', 'ok')
      showTransitionOverlay('Cargando tu panel...')
      setTimeout(() => {
        window.location.href = getRolePanelPath(body.rol)
      }, 700)
    } catch {
      hideTransitionOverlay()
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    submitButton.disabled = true

    const formData = new FormData(form)
    const email = String(formData.get('email') || '')
    const contrasena = String(formData.get('contrasena') || '')
    const nombre = String(formData.get('nombre') || '')
    const telefono = String(formData.get('telefono') || '')
    const dni = String(formData.get('dni') || '')
    const ciudadResidencia = String(formData.get('ciudad_residencia') || '')
    const fechaNacimiento = String(formData.get('fecha_nacimiento') || '')
    const especialidad = String(formData.get('especialidad') || '')
    const rol = selectedRole

    const endpoint = loginActive ? '/auth/login/' : '/auth/register/'
    const payload: Record<string, string> = loginActive
      ? { email, contrasena }
      : {
          nombre,
          email,
          contrasena,
          rol,
          telefono,
          dni,
          ciudad_residencia: ciudadResidencia,
          ...(rol === 'paciente' ? { fecha_nacimiento: fechaNacimiento } : {}),
          ...(rol === 'profesional' ? { especialidad } : {}),
        }

    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      const body = await response.json()

      if (!response.ok) {
        hideTransitionOverlay()
        showMessage(body.detail || 'No se pudo completar la operacion', 'error')
        return
      }

      localStorage.setItem('mindlink_token', body.token)
      localStorage.setItem('mindlink_user', JSON.stringify(body))
      const rolePortal = getPortalByRole(body.rol)
      if (rolePortal !== portal) {
        hideTransitionOverlay()
        localStorage.removeItem('mindlink_token')
        localStorage.removeItem('mindlink_user')
        showMessage('Este usuario no pertenece a este portal. Inicia sesion desde su acceso.', 'error')
        return
      }
      showMessage(`Sesion iniciada como ${body.rol}. Redirigiendo a tu panel...`, 'ok')
      showTransitionOverlay('Cargando tu panel...')
      setTimeout(() => {
        window.location.href = getRolePanelPath(body.rol)
      }, 700)
      form.reset()
    } catch {
      hideTransitionOverlay()
      showMessage('Error de conexion con el servidor', 'error')
    } finally {
      submitButton.disabled = false
    }
  })

  refreshSession()
}

ensureBasePath()
const activePortal = detectPortal()
const initialMode: AuthMode = activePortal === 'usuario' ? 'login' : 'login'
if (isAdminPanelRoute()) {
  void renderAdminPanel()
} else if (isPatientPanelRoute()) {
  void renderPatientPanel()
} else if (isProfessionalPanelRoute()) {
  void renderProfessionalPanel()
} else {
  render(initialMode, activePortal)
}
