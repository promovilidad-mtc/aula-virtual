export function esc(valor) {
  if (valor === null || valor === undefined) return ''
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function urlSegura(url) {
  try {
    const u = new URL(url, window.location.href)
    return ['http:', 'https:'].includes(u.protocol) ? u.href : '#'
  } catch {
    return '#'
  }
}

export function parseVideoUrl(valor) {
  const raw = String(valor || '').trim()
  if (!raw || raw === 'XXXXXXXXXX' || raw === 'null') return null

  let m = raw.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{10,})/)
  if (m) return { tipo: 'drive', id: m[1] }

  m = raw.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/)
  if (m) return { tipo: 'youtube', id: m[1] }

  if (/^[\w-]{11}$/.test(raw)) return { tipo: 'youtube', id: raw }
  return null
}

export function tipoRecurso(url) {
  const u = String(url || '').toLowerCase()
  if (/(drive|docs)\.google\.com/.test(u)) return 'drive'
  const ext = (u.split('?')[0].match(/\.(pdf|docx?|xlsx?|pptx?)$/) || [])[1]
  if (!ext) return 'link'
  return { pdf: 'pdf', doc: 'docx', docx: 'docx', xls: 'xlsx', xlsx: 'xlsx', ppt: 'pptx', pptx: 'pptx' }[ext]
}

export function mostrarCarga(texto = 'Cargando...') {
  let el = document.getElementById('carga-global')
  if (!el) {
    el = document.createElement('div')
    el.id = 'carga-global'
    el.className = 'carga-global'
    el.setAttribute('role', 'status')
    el.innerHTML = '<div class="carga-caja"><div class="carga-spin"></div><p></p></div>'
    document.body.appendChild(el)
  }
  el.querySelector('p').textContent = texto
  el.classList.remove('oculta')
}
export function ocultarCarga() {
  const el = document.getElementById('carga-global')
  if (!el) return
  el.classList.add('oculta')
  setTimeout(() => { if (el.classList.contains('oculta')) el.remove() }, 300)
}

let toastTimer = null
export function toast(msg, type = '', duracion = 3200) {
  const el = document.getElementById('toast')
  if (!el) return

  const icono = type === 'ok' ? 'fa-circle-check' : type === 'wa' ? 'fa-circle-exclamation' : 'fa-circle-info'
  const i = document.createElement('i')
  i.className = 'fa-solid ' + icono
  const span = document.createElement('span')
  span.textContent = String(msg ?? '')
  el.replaceChildren(i, span)
  el.className = 'toast ' + (type === 'ok' ? 'ok' : type === 'wa' ? 'wa' : '')
  void el.offsetWidth
  el.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('on'), duracion)
}

export function initials(nombre) {
  if (!nombre) return '??'
  return nombre.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

export function formatFecha(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  })
}

export const PERFIL_LABELS = {
  autoridades: 'Autoridades Municipales',
  tecnicos:    'Equipo Técnico Municipal',
  civil:       'Sociedad Civil',
}

export function cargando(btn, texto) {
  if (!btn) return () => {}
  const original = btn.innerHTML
  btn.disabled = true
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${esc(texto)}`
  return () => { btn.disabled = false; btn.innerHTML = original }
}

export function traducirErrorAuth(error) {
  const m = (error?.message || '').toLowerCase()
  if (m.includes('invalid login') || m.includes('invalid credentials')) return 'Usuario o contraseña incorrectos.'
  if (m.includes('email not confirmed')) return 'Aún no confirmas tu correo. Revisa tu bandeja de entrada (y la carpeta de spam).'
  if (m.includes('rate limit') || m.includes('too many')) return 'Se alcanzó el límite de correos de la plataforma. Intenta de nuevo en una hora o escribe al administrador.'
  if (m.includes('already registered')) return 'Ese correo ya tiene una cuenta registrada.'
  if (m.includes('password should be')) return 'La contraseña es muy débil. Usa al menos 8 caracteres.'
  if (m.includes('same password') || m.includes('different from the old')) return 'La nueva contraseña debe ser distinta a la anterior.'
  if (m.includes('session') && m.includes('missing')) return 'El enlace expiró o ya fue usado. Solicita uno nuevo.'
  return error?.message || 'Ocurrió un error inesperado.'
}

export const PORTADAS = [
  { archivo: 'movilidad',  nombre: 'Movilidad sostenible' },
  { archivo: 'modelos',    nombre: 'Modelos de transporte' },
  { archivo: 'rutas',      nombre: 'Plan regulador de rutas' },
  { archivo: 'gei',        nombre: 'Inventario de GEI' },
  { archivo: 'pp0148',     nombre: 'PP 0148' },
  { archivo: 'clima',      nombre: 'Cambio climático' },
  { archivo: 'acoso',      nombre: 'Acoso en el transporte' },
  { archivo: 'innovacion', nombre: 'Rutas de innovación' },
  { archivo: 'fonamus',    nombre: 'FONAMUS' },
]
export const rutaPortada = (archivo) => `assets/portadas/${archivo}.webp`

const PORTADAS_AUTO = [
  [/acoso/i, 'acoso'], [/innovaci|calidad/i, 'innovacion'], [/fonamus/i, 'fonamus'],
  [/0148/, 'pp0148'], [/clim/i, 'clima'], [/\bgei\b|invernadero/i, 'gei'],
  [/regulador|rutas/i, 'rutas'], [/modelo/i, 'modelos'], [/movilidad|sostenible/i, 'movilidad'],
]

export function portadaUrl(curso) {
  const url = String(curso?.imagen_url || '').trim()
  if (/^assets\/[\w\-/]+\.(webp|png|jpe?g)$/i.test(url) || /^https:\/\//i.test(url)) return url
  const hallada = PORTADAS_AUTO.find(([re]) => re.test(curso?.titulo || ''))
  return hallada ? rutaPortada(hallada[1]) : ''
}
