import { supabase, getUsuario, getPerfil, cerrarSesion } from './supabase.js?v=202611060003'
import { esc, toast, formatFecha, cargando, ocultarCarga, urlSegura } from './utils.js?v=202611060003'

const ADMIN = {
  usuario: null,
  solicitudes: [],
  alumnos: [],
  examenes: [],
  examenActual: null,
  esPrincipal: false,
}

const PERFIL_CORTO = {
  autoridades: 'Autoridades',
  tecnicos:    'Eq. Técnico',
  civil:       'Soc. Civil',
}

const perfilPill = (p) => p
  ? `<span class="sp sp-activo">${esc(PERFIL_CORTO[p] || p)}</span>`
  : '—'

async function initAdmin() {
  const usuario = await getUsuario()
  if (!usuario) { window.location.href = 'index.html'; return }

  const perfil = await getPerfil(usuario.id)

  if (!perfil || !(perfil.es_admin || perfil.es_profesor)) {
    window.location.href = 'catalogo.html'; return
  }

  ADMIN.usuario = usuario
  ADMIN.esPrincipal = !!perfil.es_admin
  document.getElementById('admin-email').textContent = usuario.email
  if (!ADMIN.esPrincipal) {
    const badge = document.querySelector('.admin-badge')
    if (badge) badge.innerHTML = '<i class="fa-solid fa-chalkboard-user" style="font-size:9px"></i> Panel Profesor/a'
  }
  document.getElementById('btn-salir')?.addEventListener('click', cerrarSesion)

  const btnRespaldo = document.getElementById('btn-respaldo')
  if (btnRespaldo && ADMIN.esPrincipal) {
    btnRespaldo.hidden = false
    btnRespaldo.addEventListener('click', descargarRespaldo)
  }

  document.querySelector('.admin-body')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-accion]')
    if (!btn) return
    const { accion, id } = btn.dataset
    const acciones = {
      activar:    () => cambiarEstado(id, 'activo',    'Cuenta activada'),
      rechazar:   () => confirm('¿Seguro que quieres rechazar esta solicitud?') &&
                        cambiarEstado(id, 'rechazado', 'Solicitud rechazada'),
      desactivar: () => confirm('¿Desactivar esta cuenta? El alumno no podrá ingresar al aula.') &&
                        cambiarEstado(id, 'inactivo',  'Cuenta desactivada'),
      eliminar:   () => eliminarAlumno(id),
      'hacer-prof':  () => cambiarRolProfesor(id, true),
      'quitar-prof': () => cambiarRolProfesor(id, false),
      descargar:  () => descargarExamen(id),
      revisar:    () => abrirModalNota(id),
    }
    await acciones[accion]?.()
  })

  try { await cargarTodo() } finally { ocultarCarga() }
}

async function cargarTodo() {
  await Promise.all([cargarSolicitudes(), cargarAlumnos(), cargarExamenes()])
  actualizarStats()
}

window.switchTab = (tab) => {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab))
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + tab))

  if (tab === 'solicitudes' || tab === 'alumnos') cargarTodo()
  if (tab === 'examenes') cargarExamenes().then(actualizarStats)
  document.dispatchEvent(new CustomEvent('admin:tab', { detail: tab }))
}

window.revisarTrabajoDe = async (userId, courseId) => {
  await cargarExamenes()
  const ex = ultimosTrabajos().find(e => e.user_id === userId && e.course_id === courseId)
  if (ex) abrirModalNota(ex.id)
  else toast('No se encontró el trabajo de este alumno', 'wa')
}

async function actualizarStats() {
  const pendientes = ADMIN.solicitudes.length
  const activos    = ADMIN.alumnos.filter(a => a.estado === 'activo').length
  const examPend   = ultimosTrabajos().filter(e => e.estado === 'pendiente').length

  document.getElementById('stat-pendientes').textContent = pendientes
  document.getElementById('stat-activos').textContent    = activos
  document.getElementById('stat-examenes').textContent   = examPend
  document.getElementById('badge-sol').textContent       = pendientes
  document.getElementById('badge-exam').textContent      = examPend
  document.getElementById('badge-sol').hidden            = !pendientes
  document.getElementById('badge-exam').hidden           = !examPend

  const { count } = await supabase.from('enrollments').select('id', { count: 'exact', head: true })
  document.getElementById('stat-matriculas').textContent = count || 0
}

async function cargarSolicitudes() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: false })
  if (error) { console.error(error); toast('Error cargando solicitudes: ' + error.message, 'wa'); return }
  ADMIN.solicitudes = data || []
  renderSolicitudes(ADMIN.solicitudes)
}

function renderSolicitudes(lista) {
  const el = document.getElementById('tabla-solicitudes')
  if (lista.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="fa-solid fa-inbox"></i>No hay solicitudes pendientes</div>`
    return
  }
  el.innerHTML = `<table class="admin-table">
    <thead><tr>
      <th>Nombre</th><th>Email</th><th>Perfil</th>
      <th>Cargo</th><th>Institución</th><th>Ciudad</th>
      <th>DNI</th><th>Fecha solicitud</th><th>Acciones</th>
    </tr></thead>
    <tbody>
    ${lista.map(s => `
      <tr>
        <td><strong>${esc(s.full_name) || '<span style="color:var(--red)">Sin datos</span>'}</strong></td>
        <td style="color:var(--muted)">${esc(s.email)}</td>
        <td>${perfilPill(s.perfil)}</td>
        <td>${esc(s.cargo) || '—'}</td>
        <td>${esc(s.institucion) || '—'}</td>
        <td>${esc(s.ciudad) || '—'}</td>
        <td style="font-family:monospace;font-size:12px">${esc(s.dni) || '—'}</td>
        <td style="color:var(--muted);font-size:12px">${formatFecha(s.created_at)}</td>
        <td>
          <div class="act-btns">
            ${s.perfil && s.full_name && s.dni
              ? `<button class="act-btn ab-activar" data-accion="activar" data-id="${esc(s.id)}">
                  <i class="fa-solid fa-check"></i> Activar</button>`
              : `<span class="sp sp-pendiente" title="Entró con Google pero aún no completa su formulario">Datos incompletos</span>`}
            <button class="act-btn ab-rechazar" data-accion="rechazar" data-id="${esc(s.id)}">
              <i class="fa-solid fa-xmark"></i> Rechazar
            </button>
          </div>
        </td>
      </tr>`).join('')}
    </tbody>
  </table>`
}

async function cambiarEstado(id, estado, mensaje) {
  const { error } = await supabase.from('profiles').update({ estado }).eq('id', id)
  if (error) { toast('Error: ' + error.message, 'wa'); return }
  toast(mensaje, 'ok')
  await cargarTodo()
}

async function cargarAlumnos() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .neq('estado', 'pendiente')
    .eq('es_admin', false)
    .order('created_at', { ascending: false })
  if (error) { console.error(error); toast('Error cargando alumnos: ' + error.message, 'wa'); return }
  ADMIN.alumnos = data || []
  renderAlumnos(ADMIN.alumnos)
}

function renderAlumnos(lista) {
  const el = document.getElementById('tabla-alumnos')
  if (lista.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="fa-solid fa-users"></i>No hay alumnos registrados</div>`
    return
  }
  el.innerHTML = `<table class="admin-table">
    <thead><tr>
      <th>Nombre</th><th>Email</th><th>Perfil</th>
      <th>Institución</th><th>Estado</th>
      <th>Última actividad</th><th>Acciones</th>
    </tr></thead>
    <tbody>
    ${lista.map(a => `
      <tr>
        <td><strong>${esc(a.full_name) || '—'}</strong>
          ${a.es_profesor ? '<div><span class="sp sp-perfil" style="margin-top:4px"><i class="fa-solid fa-chalkboard-user"></i> Profesor/a</span></div>' : ''}</td>
        <td style="color:var(--muted);font-size:12px">${esc(a.email)}</td>
        <td>${perfilPill(a.perfil)}</td>
        <td style="font-size:12px">${esc(a.institucion) || '—'}</td>
        <td><span class="sp sp-${esc(a.estado)}">${esc(a.estado)}</span></td>
        <td style="color:var(--muted);font-size:12px">${formatFecha(a.ultima_actividad)}</td>
        <td>
          <div class="act-btns">
            ${a.estado === 'activo'
              ? `<button class="act-btn ab-desactivar" data-accion="desactivar" data-id="${esc(a.id)}">
                  <i class="fa-solid fa-ban"></i> Desactivar</button>`
              : `<button class="act-btn ab-activar" data-accion="activar" data-id="${esc(a.id)}">
                  <i class="fa-solid fa-check"></i> Activar</button>`}
            ${ADMIN.esPrincipal ? (a.es_profesor
              ? `<button class="act-btn ab-desactivar" data-accion="quitar-prof" data-id="${esc(a.id)}" title="Vuelve a ser alumno">
                  <i class="fa-solid fa-user-minus"></i> Quitar profesor/a</button>`
              : `<button class="act-btn ab-nota" data-accion="hacer-prof" data-id="${esc(a.id)}" title="Podrá editar cursos y hacer seguimiento">
                  <i class="fa-solid fa-chalkboard-user"></i> Hacer profesor/a</button>`) : ''}
            ${ADMIN.esPrincipal ? `<button class="act-btn ab-eliminar" data-accion="eliminar" data-id="${esc(a.id)}">
              <i class="fa-solid fa-trash"></i> Eliminar
            </button>` : ''}
          </div>
        </td>
      </tr>`).join('')}
    </tbody>
  </table>`
}

async function cambiarRolProfesor(id, valor) {
  const a = ADMIN.alumnos.find(x => x.id === id)
  const msg = valor
    ? `¿Hacer profesor/a a ${a?.full_name || a?.email}?\n\nPodrá crear y editar cursos, ver el seguimiento, aprobar alumnos, revisar trabajos, responder consultas y emitir certificados. No podrá eliminar cuentas ni cambiar roles.`
    : `¿Quitar el rol de profesor/a a ${a?.full_name || a?.email}? Volverá a ser un alumno normal.`
  if (!confirm(msg)) return
  const { error } = await supabase.from('profiles').update({ es_profesor: valor }).eq('id', id)
  if (error) { toast('No se pudo cambiar el rol: ' + error.message, 'wa', 6000); return }
  toast(valor ? 'Ahora es profesor/a (debe volver a entrar a la web)' : 'Rol de profesor/a quitado', 'ok', 5000)
  await cargarTodo()
}

async function eliminarAlumno(id) {
  const a = ADMIN.alumnos.find(x => x.id === id)
  if (!confirm(`¿Eliminar el perfil de ${a?.email || 'este alumno'}? Se borrarán sus datos y su progreso. No se puede deshacer.`)) return
  const { error } = await supabase.from('profiles').delete().eq('id', id)
  if (error) { toast('No se pudo eliminar: ' + error.message, 'wa', 6000); return }
  toast('Perfil eliminado. Su cuenta de acceso se borra desde la consola de la base de datos (Authentication → Users).', 'ok', 7000)
  await cargarTodo()
}

const ESTADO_TRABAJO = {
  pendiente:   ['pendiente',  'En revisión'],
  revisado:    ['activo',     'Conforme'],
  aprobado:    ['activo',     'Conforme'],
  desaprobado: ['rechazado',  'Observado'],
}

async function cargarExamenes() {
  const { data, error } = await supabase
    .from('exam_submissions')
    .select(`*, profiles(full_name, email), courses(titulo)`)
    .order('created_at', { ascending: false })
  if (error) { console.error(error); toast('Error cargando trabajos: ' + error.message, 'wa'); return }
  ADMIN.examenes = data || []
  window.filtrarTrabajos()
}

function ultimosTrabajos() {
  const vistos = new Set()
  return ADMIN.examenes.filter(e => {
    const k = e.user_id + '|' + e.course_id
    if (vistos.has(k)) return false
    vistos.add(k); return true
  })
}

window.filtrarTrabajos = () => {
  const filtro = document.getElementById('filtro-trab')?.value ?? 'pendiente'
  renderExamenes(filtro ? ultimosTrabajos().filter(e => e.estado === filtro) : ADMIN.examenes)
}

function renderExamenes(lista) {
  const el = document.getElementById('tabla-examenes')
  if (lista.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="fa-solid fa-file-circle-check"></i>No hay trabajos ${document.getElementById('filtro-trab')?.value ? 'por revisar' : 'entregados'}</div>`
    return
  }
  el.innerHTML = `<table class="admin-table">
    <thead><tr>
      <th>Alumno</th><th>Curso</th><th>Trabajo</th>
      <th>Entregado</th><th>Estado</th><th>Comentario</th><th>Acciones</th>
    </tr></thead>
    <tbody>
    ${lista.map(e => {
      const [pill, txt] = ESTADO_TRABAJO[e.estado] || ['inactivo', e.estado]
      const trabajo = e.enlace_url
        ? `<a class="act-btn ab-ver" href="${esc(urlSegura(e.enlace_url))}" target="_blank" rel="noopener"><i class="fa-brands fa-google-drive"></i> Abrir</a>`
        : e.storage_path
          ? `<button class="act-btn ab-ver" data-accion="descargar" data-id="${esc(e.id)}"><i class="fa-solid fa-download"></i> ${esc(e.archivo_nombre || 'Archivo')}</button>`
          : '—'
      return `
      <tr>
        <td>
          <strong>${esc(e.profiles?.full_name) || '—'}</strong>
          <div style="font-size:11px;color:var(--muted)">${esc(e.profiles?.email)}</div>
        </td>
        <td style="font-size:12px">${esc(e.courses?.titulo) || '—'}</td>
        <td>${trabajo}</td>
        <td style="color:var(--muted);font-size:12px">${formatFecha(e.created_at)}</td>
        <td><span class="sp sp-${pill}">${esc(txt)}</span></td>
        <td style="font-size:12px;color:var(--gray-500)">${esc(e.comentario) || '—'}</td>
        <td>
          <button class="act-btn ab-nota" data-accion="revisar" data-id="${esc(e.id)}">
            <i class="fa-solid fa-pen"></i> ${e.estado === 'pendiente' ? 'Revisar' : 'Cambiar'}
          </button>
        </td>
      </tr>`
    }).join('')}
    </tbody>
  </table>`
}

async function descargarExamen(examId) {
  const ex = ADMIN.examenes.find(e => e.id === examId)
  if (!ex?.storage_path) return
  const { data, error } = await supabase.storage.from('examenes').createSignedUrl(ex.storage_path, 60)
  if (error) { toast('Error al obtener el archivo', 'wa'); return }
  window.open(data.signedUrl, '_blank', 'noopener')
}

function abrirModalNota(examId) {
  const ex = ADMIN.examenes.find(e => e.id === examId)
  if (!ex) return
  ADMIN.examenActual = ex
  document.getElementById('modal-nota-desc').textContent =
    `${ex.profiles?.full_name || 'Alumno'} · ${ex.courses?.titulo || 'Curso'}`
  const abrir = document.getElementById('rev-abrir')
  abrir.hidden = !ex.enlace_url
  if (ex.enlace_url) abrir.href = urlSegura(ex.enlace_url)
  document.getElementById('input-comentario').value = ex.comentario || ''
  document.getElementById('modal-nota').classList.add('open')
  document.getElementById('input-comentario').focus()
}

window.cerrarModalNota = () => {
  document.getElementById('modal-nota').classList.remove('open')
  ADMIN.examenActual = null
}

window.guardarRevision = async (estado) => {
  const ex = ADMIN.examenActual
  if (!ex) return
  const comentario = document.getElementById('input-comentario').value.trim()
  if (estado === 'desaprobado' && !comentario) {
    toast('Escribe qué debe corregir el alumno', 'wa'); return
  }
  const btn = document.getElementById(estado === 'revisado' ? 'btn-guardar-nota' : 'btn-observar')
  const restaurar = cargando(btn, 'Guardando...')
  const { error } = await supabase
    .from('exam_submissions')
    .update({ estado, comentario: comentario || null, nota_admin: null, revisado_at: new Date().toISOString() })
    .eq('id', ex.id)
  restaurar()
  if (error) { toast('No se pudo guardar: ' + error.message, 'wa', 6000); return }
  toast(estado === 'revisado'
    ? 'Trabajo conforme. Si el alumno terminó el curso, ya puedes emitir su certificado en "Seguimiento".'
    : 'Trabajo observado. El alumno verá tu comentario y podrá reenviarlo.', 'ok', 6000)
  window.cerrarModalNota()
  await cargarExamenes()
  actualizarStats()
  document.dispatchEvent(new CustomEvent('admin:trabajo-revisado'))
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.cerrarModalNota() })
document.getElementById('modal-nota')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal-nota') window.cerrarModalNota()
})

window.filtrarTabla = (tipo) => {
  const q = (document.getElementById('search-' + tipo)?.value || '').toLowerCase()
  const coincide = (p) => [p.full_name, p.email, p.dni, p.institucion]
    .some(v => (v || '').toLowerCase().includes(q))
  if (tipo === 'sol') renderSolicitudes(ADMIN.solicitudes.filter(coincide))
  else                renderAlumnos(ADMIN.alumnos.filter(coincide))
}

const HOJAS_RESPALDO = [
  ['alumnos',            'Alumnos'],
  ['matriculas',         'Matrículas'],
  ['avance',             'Avance de clases'],
  ['notas_quiz',         'Notas de quizzes'],
  ['quizzes_abiertos',   'Quizzes abiertos'],
  ['trabajos',           'Trabajos finales'],
  ['consultas',          'Consultas'],
  ['certificados',       'Certificados'],
  ['historial_intentos', 'Historial de intentos'],
  ['cursos',             'Cursos'],
  ['modulos',            'Módulos'],
  ['clases',             'Clases'],
  ['preguntas_quiz',     'Preguntas de quiz'],
]
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}/

function celdaExcel(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'string' && FECHA_ISO.test(v)) {
    const d = new Date(v)
    return isNaN(d) ? v : d
  }
  return v
}

async function descargarRespaldo(e) {
  if (!ADMIN.esPrincipal) return
  const restaurar = cargando(e.currentTarget, 'Preparando...')
  try {
    const { data, error } = await supabase.rpc('admin_respaldo')
    if (error) { toast('No se pudo generar el respaldo: ' + error.message, 'wa', 7000); return }

    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')
    const libro = XLSX.utils.book_new()

    const generado = new Date(data.generado_el || Date.now())
    const resumen = [
      ['Respaldo del Aula Virtual PROMOVILIDAD'],
      [],
      ['Generado el', generado],
      ['Generado por', ADMIN.usuario?.email || ''],
      [],
      ['IMPORTANTE: este archivo contiene datos personales (nombres, DNI, correos).'],
      ['Guárdalo en un lugar privado y no lo compartas.'],
      [],
      ['Hoja', 'Registros'],
      ...HOJAS_RESPALDO.map(([k, nombre]) => [nombre, (data[k] || []).length]),
    ]
    const hojaResumen = XLSX.utils.aoa_to_sheet(resumen, { cellDates: true, dateNF: 'dd/mm/yyyy hh:mm' })
    hojaResumen['!cols'] = [{ wch: 28 }, { wch: 40 }]
    XLSX.utils.book_append_sheet(libro, hojaResumen, 'Resumen')

    for (const [clave, nombre] of HOJAS_RESPALDO) {
      const filas = (data[clave] || []).map(f => {
        const o = {}
        for (const [k, v] of Object.entries(f)) o[k] = celdaExcel(v)
        return o
      })
      const hoja = filas.length
        ? XLSX.utils.json_to_sheet(filas, { cellDates: true, dateNF: 'dd/mm/yyyy hh:mm' })
        : XLSX.utils.aoa_to_sheet([['(sin registros)']])

      if (filas.length) {
        hoja['!cols'] = Object.keys(filas[0]).map(k => ({
          wch: Math.min(50, Math.max(k.length, ...filas.slice(0, 200).map(f => String(f[k] ?? '').length)) + 2),
        }))
      }
      XLSX.utils.book_append_sheet(libro, hoja, nombre.slice(0, 31))
    }

    const dos = (n) => String(n).padStart(2, '0')
    const sello = `${generado.getFullYear()}-${dos(generado.getMonth() + 1)}-${dos(generado.getDate())} ${dos(generado.getHours())}h${dos(generado.getMinutes())}`
    XLSX.writeFile(libro, `Respaldo Aula PROMOVILIDAD ${sello}.xlsx`)
    toast('Respaldo descargado. Guárdalo en un lugar privado: tiene datos personales.', 'ok', 7000)
  } catch (err) {
    console.error(err)
    toast('No se pudo generar el respaldo: ' + (err?.message || err), 'wa', 7000)
  } finally {
    restaurar()
  }
}

initAdmin()
