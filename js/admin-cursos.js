import { supabase, getUsuario, getPerfil } from './supabase.js?v=202611060003'
import { esc, toast, cargando, urlSegura, parseVideoUrl, tipoRecurso, PORTADAS, rutaPortada, portadaUrl } from './utils.js?v=202611060003'

const PERFILES = [
  ['autoridades', 'Autoridades municipales'],
  ['tecnicos',    'Equipo técnico municipal'],
  ['civil',       'Sociedad civil'],
]
const PERFIL_CORTO = { autoridades: 'Autoridades', tecnicos: 'Eq. técnico', civil: 'Soc. civil' }

const ED = {
  cursos: [],
  cursoActual: null,
  modulos: [],
  moduloActual: null,
  clases: [],
  guardar: null,
  videoToken: 0,
}

const $ = (id) => document.getElementById(id)

function msgError(error) {
  if (!error) return ''
  if (error.code === '23503') {
    return 'No se puede borrar porque tiene datos de alumnos (avance, notas o matrículas). Puedes ocultarlo en su lugar.'
  }
  if (error.code === '42501' || /row-level security|permission denied/i.test(error.message)) {
    return 'No tienes permiso para hacer este cambio.'
  }
  return error.message
}

async function initEditor() {
  const usuario = await getUsuario()
  if (!usuario) return
  const perfil = await getPerfil(usuario.id)
  if (!perfil?.es_admin && !perfil?.es_profesor) return

  $('editor-cursos').addEventListener('click', onClickEditor)
  $('me-cancelar').addEventListener('click', () => cerrarModal())
  $('me-guardar').addEventListener('click', async (e) => {
    if (!ED.guardar) return
    const restaurar = cargando(e.currentTarget, 'Guardando...')
    const ok = await ED.guardar()
    restaurar()
    if (ok) cerrarModal(true)
  })

  $('me-form').addEventListener('input',  () => { ED.sucio = true })
  $('me-form').addEventListener('change', () => { ED.sucio = true })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('modal-editor').classList.contains('open')) cerrarModal()
  })

  await cargarCursos()
}

function onClickEditor(e) {
  const b = e.target.closest('[data-ed]')
  if (!b) return
  const { ed, id } = b.dataset
  const acciones = {
    'nuevo-curso':   () => abrirModalCurso(null),
    'editar-curso':  () => abrirModalCurso(ED.cursos.find(c => c.id === id)),
    'abrir-curso':   () => abrirCurso(id),
    'subir-curso':   () => mover(ED.cursos, id, -1, 'courses', cargarCursos),
    'bajar-curso':   () => mover(ED.cursos, id, +1, 'courses', cargarCursos),
    'borrar-curso':  () => borrarCurso(id),
    'volver':        () => cargarCursos(),
    'nuevo-modulo':  () => abrirModalModulo(null),
    'editar-modulo': () => abrirModalModulo(ED.modulos.find(m => m.id === id)),
    'subir-modulo':  () => mover(ED.modulos, id, -1, 'modules', recargarModulos),
    'bajar-modulo':  () => mover(ED.modulos, id, +1, 'modules', recargarModulos),
    'ver-modulo':    () => alternarModulo(id),
    'borrar-modulo': () => borrarModulo(id),
    'abrir-modulo':  () => abrirModulo(id),
    'volver-modulos':() => { ED.moduloActual = null; recargarModulos() },
    'nueva-clase':   () => abrirModalClase(null),
    'editar-clase':  () => abrirModalClase(ED.clases.find(c => c.id === id)),
    'subir-clase':   () => mover(ED.clases, id, -1, 'classes', recargarClases),
    'bajar-clase':   () => mover(ED.clases, id, +1, 'classes', recargarClases),
    'ver-clase':     () => alternarClase(id),
    'borrar-clase':  () => borrarClase(id),
    'quiz-clase':    () => abrirModalQuiz(ED.clases.find(c => c.id === id)),
  }
  acciones[ed]?.()
}

async function cargarCursos() {
  ED.cursoActual = null
  ED.moduloActual = null
  const { data, error } = await supabase
    .from('courses')
    .select('*, course_profiles(perfil), modules(id, classes(count)), enrollments(count)')
    .order('orden')
    .order('created_at')
  if (error) {
    $('editor-cursos').innerHTML = `<div class="empty-state">Error cargando cursos: ${esc(error.message)}</div>`
    return
  }
  ED.cursos = data || []
  renderCursos()
}

function renderCursos() {
  const lista = ED.cursos
  const filas = lista.map((c, i) => {
    const perfiles  = (c.course_profiles || []).map(p => `<span class="sp sp-perfil">${esc(PERFIL_CORTO[p.perfil] || p.perfil)}</span>`).join(' ')
    const nMod      = (c.modules || []).length
    const nClases   = (c.modules || []).reduce((s, m) => s + (m.classes?.[0]?.count || 0), 0)
    const nAlumnos  = c.enrollments?.[0]?.count || 0
    return `
    <li class="ed-item${c.activo ? '' : ' ed-oculto'}">
      <div class="ed-flechas">
        <button class="ed-flecha" data-ed="subir-curso" data-id="${esc(c.id)}" title="Subir" ${i === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up"></i></button>
        <button class="ed-flecha" data-ed="bajar-curso" data-id="${esc(c.id)}" title="Bajar" ${i === lista.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down"></i></button>
      </div>
      <div class="ed-num">${i + 1}</div>
      ${portadaUrl(c) ? `<img class="ed-mini" src="${esc(portadaUrl(c))}" alt="" loading="lazy"/>` : '<span class="ed-mini ed-mini-vacia"><i class="fa-solid fa-image"></i></span>'}
      <div class="ed-main">
        <div class="ed-titulo">${esc(c.titulo)}</div>
        <div class="ed-meta">
          ${c.activo ? '<span class="sp sp-activo">Publicado</span>' : '<span class="sp sp-oculto">Oculto</span>'}
          ${perfiles || '<span class="sp sp-rechazado">Sin perfil</span>'}
          <span>· ${nMod} módulo${nMod === 1 ? '' : 's'} · ${nClases} clase${nClases === 1 ? '' : 's'} · ${nAlumnos} matriculado${nAlumnos === 1 ? '' : 's'}</span>
          ${c.requiere_trabajo ? '<span>· <i class="fa-solid fa-file-circle-check"></i> Pide trabajo final</span>' : ''}
        </div>
      </div>
      <div class="ed-acts">
        <button class="act-btn ab-ver" data-ed="abrir-curso" data-id="${esc(c.id)}"><i class="fa-solid fa-layer-group"></i> Módulos</button>
        <button class="act-btn ab-nota" data-ed="editar-curso" data-id="${esc(c.id)}"><i class="fa-solid fa-pen"></i> Editar</button>
        <button class="act-btn ab-eliminar" data-ed="borrar-curso" data-id="${esc(c.id)}" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
      </div>
    </li>`
  }).join('')

  $('editor-cursos').innerHTML = `
    <div class="ed-toolbar">
      <div>
        <h3>Cursos</h3>
        <div class="ed-sub">Crea y ordena los cursos. Dentro de cada curso están sus módulos.</div>
      </div>
      <button class="btn btn-sm btn-grad" data-ed="nuevo-curso"><i class="fa-solid fa-plus"></i> Nuevo curso</button>
    </div>
    ${lista.length ? `<ul class="ed-list">${filas}</ul>`
                   : '<div class="empty-state"><i class="fa-solid fa-book-open"></i>Todavía no hay cursos</div>'}`
}

function abrirModalCurso(curso) {
  const nuevo = !curso
  const sel = new Set((curso?.course_profiles || []).map(p => p.perfil))
  const actual = curso?.imagen_url || ''
  $('me-titulo').textContent = nuevo ? 'Nuevo curso' : 'Editar curso'
  $('me-desc').textContent = nuevo ? 'El curso se crea oculto hasta que marques "Publicado".' : ''
  $('me-form').innerHTML = `
    <div class="fg">
      <label class="fl" for="fc-titulo">Título del curso *</label>
      <input class="fi" id="fc-titulo" maxlength="200" value="${esc(curso?.titulo || '')}"/>
    </div>
    <div class="fg">
      <label class="fl" for="fc-desc">Descripción (1 o 2 líneas, se ve en el catálogo)</label>
      <textarea id="fc-desc" maxlength="600">${esc(curso?.descripcion || '')}</textarea>
    </div>
    <div class="fg">
      <span class="fl">Portada del curso</span>
      <div class="ed-portadas" role="radiogroup" aria-label="Portada del curso">
        <label class="ed-portada" title="Se elige sola según el título del curso">
          <input type="radio" name="fc-portada" value="" ${actual ? '' : 'checked'}/>
          <span class="ed-portada-auto"><i class="fa-regular fa-image"></i></span>
          <span class="ed-portada-nom">Automática</span>
        </label>
        ${actual && !PORTADAS.some(p => rutaPortada(p.archivo) === actual) ? `
        <label class="ed-portada" title="Imagen que ya tenía el curso">
          <input type="radio" name="fc-portada" value="${esc(actual)}" checked/>
          <img src="${esc(actual)}" alt="" loading="lazy"/>
          <span class="ed-portada-nom">Imagen actual</span>
        </label>` : ''}
        ${PORTADAS.map(p => {
          const ruta = rutaPortada(p.archivo)
          return `<label class="ed-portada" title="${esc(p.nombre)}">
            <input type="radio" name="fc-portada" value="${esc(ruta)}" ${actual === ruta ? 'checked' : ''}/>
            <img src="${esc(ruta)}" alt="" loading="lazy"/>
            <span class="ed-portada-nom">${esc(p.nombre)}</span>
          </label>`
        }).join('')}
      </div>
      <div class="ed-nota">"Automática" elige la imagen según el título. Para sumar portadas nuevas, pídelas al administrador.</div>
    </div>
    <div class="fg">
      <span class="fl">¿Para qué perfiles es este curso? *</span>
      <div class="ed-checks">
        ${PERFILES.map(([v, l]) => `
          <label class="ed-check"><input type="checkbox" name="fc-perfil" value="${v}" ${sel.has(v) ? 'checked' : ''}/> ${l}</label>`).join('')}
      </div>
      ${nuevo ? '' : '<div class="ed-nota">Si quitas un perfil, los alumnos de ese perfil dejarán de ver el curso.</div>'}
    </div>
    <div class="fg ed-checks">
      <label class="ed-check"><input type="checkbox" id="fc-activo" ${curso?.activo ? 'checked' : ''}/>
        <span>Publicado<small>Si está apagado, ningún alumno ve el curso (ni los matriculados).</small></span></label>
      <label class="ed-check"><input type="checkbox" id="fc-trabajo" ${curso?.requiere_trabajo ? 'checked' : ''}/>
        <span>Pide trabajo final<small>El alumno pega el enlace de Drive de su trabajo y debe estar "conforme" para aprobar.</small></span></label>
    </div>`
  ED.guardar = () => guardarCurso(curso)
  abrirModal()
  $('fc-titulo').focus()
}

async function guardarCurso(curso) {
  const titulo   = $('fc-titulo').value.trim()
  const desc     = $('fc-desc').value.trim()
  const perfiles = [...document.querySelectorAll('input[name="fc-perfil"]:checked')].map(i => i.value)
  if (!titulo)          { toast('Escribe el título del curso', 'wa'); return false }
  if (!perfiles.length) { toast('Elige al menos un perfil', 'wa'); return false }

  const datos = {
    titulo,
    descripcion: desc || null,
    activo: $('fc-activo').checked,
    requiere_trabajo: $('fc-trabajo').checked,
    imagen_url: document.querySelector('input[name="fc-portada"]:checked')?.value || null,
  }

  let id = curso?.id
  if (id) {
    const { error } = await supabase.from('courses').update(datos).eq('id', id)
    if (error) { toast('No se pudo guardar: ' + msgError(error), 'wa', 6000); return false }
  } else {
    datos.orden = Math.max(0, ...ED.cursos.map(c => c.orden || 0)) + 1
    const { data, error } = await supabase.from('courses').insert(datos).select('id').single()
    if (error) { toast('No se pudo crear: ' + msgError(error), 'wa', 6000); return false }
    id = data.id
  }

  const antes  = new Set((curso?.course_profiles || []).map(p => p.perfil))
  const quitar = [...antes].filter(p => !perfiles.includes(p))
  const poner  = perfiles.filter(p => !antes.has(p)).map(perfil => ({ course_id: id, perfil }))
  if (quitar.length) {
    const { error } = await supabase.from('course_profiles').delete().eq('course_id', id).in('perfil', quitar)
    if (error) { toast('El curso se guardó, pero falló al quitar perfiles: ' + msgError(error), 'wa', 6000); return false }
  }
  if (poner.length) {
    const { error } = await supabase.from('course_profiles').insert(poner)
    if (error) { toast('El curso se guardó, pero falló al asignar perfiles: ' + msgError(error), 'wa', 6000); return false }
  }

  toast(curso ? 'Curso actualizado' : 'Curso creado', 'ok')
  await cargarCursos()
  return true
}

async function borrarCurso(id) {
  const c = ED.cursos.find(x => x.id === id)
  if (!c) return
  const nAlumnos = c.enrollments?.[0]?.count || 0
  if (nAlumnos > 0) {
    toast(`Este curso tiene ${nAlumnos} matriculado(s), no se puede borrar. Puedes ocultarlo desde "Editar" (desmarca "Publicado").`, 'wa', 8000)
    return
  }
  if (!confirm(`¿Eliminar el curso "${c.titulo}" con todos sus módulos, clases y quizzes? No se puede deshacer.`)) return
  const { error, count } = await supabase.from('courses').delete({ count: 'exact' }).eq('id', id)
  if (error)  { toast('No se pudo eliminar: ' + msgError(error), 'wa', 8000); return }
  if (!count) { toast('No se eliminó el curso (revisa tus permisos).', 'wa', 6000); return }
  toast('Curso eliminado', 'ok')
  await cargarCursos()
}

async function abrirCurso(id) {
  ED.cursoActual = ED.cursos.find(c => c.id === id) || null
  if (!ED.cursoActual) return
  await recargarModulos()
}

async function recargarModulos() {
  const curso = ED.cursoActual
  if (!curso) return
  const { data, error } = await supabase
    .from('modules')
    .select('*, classes(count)')
    .eq('course_id', curso.id)
    .order('orden')
    .order('created_at')
  if (error) { toast('Error cargando módulos: ' + error.message, 'wa'); return }
  ED.modulos = data || []
  renderModulos()
}

function renderModulos() {
  const curso = ED.cursoActual
  const lista = ED.modulos
  const filas = lista.map((m, i) => {
    const nClases = m.classes?.[0]?.count || 0
    return `
    <li class="ed-item${m.visible ? '' : ' ed-oculto'}">
      <div class="ed-flechas">
        <button class="ed-flecha" data-ed="subir-modulo" data-id="${esc(m.id)}" title="Subir" ${i === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up"></i></button>
        <button class="ed-flecha" data-ed="bajar-modulo" data-id="${esc(m.id)}" title="Bajar" ${i === lista.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down"></i></button>
      </div>
      <div class="ed-num">${i + 1}</div>
      <div class="ed-main">
        <div class="ed-titulo">${esc(m.titulo)}</div>
        <div class="ed-meta">
          ${m.visible ? '<span class="sp sp-activo">Visible</span>' : '<span class="sp sp-oculto">Oculto</span>'}
          <span>· ${nClases} clase${nClases === 1 ? '' : 's'}</span>
          ${m.descripcion ? `<span>· ${esc(m.descripcion.slice(0, 90))}${m.descripcion.length > 90 ? '…' : ''}</span>` : ''}
        </div>
      </div>
      <div class="ed-acts">
        <button class="act-btn ab-ver" data-ed="abrir-modulo" data-id="${esc(m.id)}"><i class="fa-solid fa-list"></i> Clases</button>
        <button class="act-btn ab-nota" data-ed="editar-modulo" data-id="${esc(m.id)}"><i class="fa-solid fa-pen"></i> Editar</button>
        <button class="act-btn ${m.visible ? 'ab-desactivar' : 'ab-activar'}" data-ed="ver-modulo" data-id="${esc(m.id)}">
          <i class="fa-solid ${m.visible ? 'fa-eye-slash' : 'fa-eye'}"></i> ${m.visible ? 'Ocultar' : 'Mostrar'}</button>
        <button class="act-btn ab-eliminar" data-ed="borrar-modulo" data-id="${esc(m.id)}" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
      </div>
    </li>`
  }).join('')

  $('editor-cursos').innerHTML = `
    <div class="ed-toolbar">
      <div>
        <button class="ed-back" data-ed="volver"><i class="fa-solid fa-arrow-left"></i> Todos los cursos</button>
        <h3>${esc(curso.titulo)}</h3>
        <div class="ed-sub">Módulos del curso, en el orden en que los verá el alumno. Entra a "Clases" para cargar los videos y materiales.</div>
      </div>
      <button class="btn btn-sm btn-grad" data-ed="nuevo-modulo"><i class="fa-solid fa-plus"></i> Nuevo módulo</button>
    </div>
    ${lista.length ? `<ul class="ed-list">${filas}</ul>`
                   : '<div class="empty-state"><i class="fa-solid fa-layer-group"></i>Este curso todavía no tiene módulos</div>'}`
}

function abrirModalModulo(modulo) {
  const nuevo = !modulo
  $('me-titulo').textContent = nuevo ? 'Nuevo módulo' : 'Editar módulo'
  $('me-desc').textContent = ED.cursoActual?.titulo || ''
  $('me-form').innerHTML = `
    <div class="fg">
      <label class="fl" for="fm-titulo">Título del módulo *</label>
      <input class="fi" id="fm-titulo" maxlength="200" placeholder="Ej.: Módulo 2: Gestión del transporte público" value="${esc(modulo?.titulo || '')}"/>
    </div>
    <div class="fg">
      <label class="fl" for="fm-desc">Descripción (opcional)</label>
      <textarea id="fm-desc" maxlength="1000">${esc(modulo?.descripcion || '')}</textarea>
    </div>
    <div class="fg ed-checks">
      <label class="ed-check"><input type="checkbox" id="fm-visible" ${nuevo || modulo.visible ? 'checked' : ''}/>
        <span>Visible para los alumnos<small>Si lo ocultas, sus clases no se ven ni cuentan para el promedio.</small></span></label>
    </div>`
  ED.guardar = () => guardarModulo(modulo)
  abrirModal()
  $('fm-titulo').focus()
}

async function guardarModulo(modulo) {
  const titulo = $('fm-titulo').value.trim()
  if (!titulo) { toast('Escribe el título del módulo', 'wa'); return false }
  const datos = {
    titulo,
    descripcion: $('fm-desc').value.trim() || null,
    visible: $('fm-visible').checked,
  }
  let error
  if (modulo) {
    ({ error } = await supabase.from('modules').update(datos).eq('id', modulo.id))
  } else {
    datos.course_id = ED.cursoActual.id
    datos.orden = Math.max(0, ...ED.modulos.map(m => m.orden || 0)) + 1
    ;({ error } = await supabase.from('modules').insert(datos))
  }
  if (error) { toast('No se pudo guardar: ' + msgError(error), 'wa', 6000); return false }
  toast(modulo ? 'Módulo actualizado' : 'Módulo creado', 'ok')
  await recargarModulos()
  return true
}

async function alternarModulo(id) {
  const m = ED.modulos.find(x => x.id === id)
  if (!m) return
  if (m.visible && !confirm(`¿Ocultar "${m.titulo}"? Sus clases dejarán de verse y no contarán para el promedio. Puedes volver a mostrarlo cuando quieras.`)) return
  const { error } = await supabase.from('modules').update({ visible: !m.visible }).eq('id', id)
  if (error) { toast('No se pudo cambiar: ' + msgError(error), 'wa', 6000); return }
  toast(m.visible ? 'Módulo oculto' : 'Módulo visible', 'ok')
  await recargarModulos()
}

async function borrarModulo(id) {
  const m = ED.modulos.find(x => x.id === id)
  if (!m) return
  const nClases = m.classes?.[0]?.count || 0
  const aviso = nClases
    ? `¿Eliminar "${m.titulo}" y sus ${nClases} clase(s) con sus quizzes? No se puede deshacer.\n\nSi algún alumno ya avanzó en estas clases, la plataforma no lo dejará borrar (en ese caso, ocúltalo).`
    : `¿Eliminar el módulo "${m.titulo}"?`
  if (!confirm(aviso)) return
  const { error, count } = await supabase.from('modules').delete({ count: 'exact' }).eq('id', id)
  if (error)  { toast('No se pudo eliminar: ' + msgError(error), 'wa', 8000); return }
  if (!count) { toast('No se eliminó el módulo (revisa tus permisos).', 'wa', 6000); return }
  toast('Módulo eliminado', 'ok')
  await recargarModulos()
}

const fmtDur = (seg) => {
  seg = Number(seg) || 0
  if (!seg) return ''
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0')
}

const leerDur = (txt) => {
  const t = String(txt || '').trim()
  if (!t) return 0
  if (!t.includes(':')) return Math.round(Number(t) * 60) || 0
  return t.split(':').map(Number).reduce((acc, n) => acc * 60 + (n || 0), 0)
}

async function abrirModulo(id) {
  ED.moduloActual = ED.modulos.find(m => m.id === id) || null
  if (!ED.moduloActual) return
  await recargarClases()
}

async function recargarClases() {
  const mod = ED.moduloActual
  if (!mod) return
  const { data, error } = await supabase
    .from('classes').select('*, progress(count)')
    .eq('module_id', mod.id)
    .order('orden').order('created_at')
  if (error) { toast('Error cargando clases: ' + error.message, 'wa'); return }
  ED.clases = data || []

  const ids = ED.clases.map(c => c.id)
  const conteo = {}
  if (ids.length) {
    const { data: qs } = await supabase.from('quiz_questions').select('class_id').in('class_id', ids)
    ;(qs || []).forEach(q => { conteo[q.class_id] = (conteo[q.class_id] || 0) + 1 })
  }
  ED.clases.forEach(c => { c.nPreguntas = conteo[c.id] || 0 })
  renderClases()
}

function iconoVideo(clase) {
  const v = parseVideoUrl(clase.youtube_id)
  if (v?.tipo === 'youtube') return '<i class="fa-brands fa-youtube" style="color:#ff0000" title="Video de YouTube"></i>'
  if (v?.tipo === 'drive')   return '<i class="fa-brands fa-google-drive" style="color:#1fa463" title="Archivo de Drive"></i>'
  return '<i class="fa-solid fa-book-open" style="color:var(--muted)" title="Lectura (sin video)"></i>'
}

function renderClases() {
  const curso = ED.cursoActual, mod = ED.moduloActual, lista = ED.clases
  const filas = lista.map((c, i) => {
    const nRec   = Array.isArray(c.recursos) ? c.recursos.length : 0
    const nQuiz  = c.nPreguntas || 0
    const nAlum  = c.progress?.[0]?.count || 0
    const dur    = fmtDur(c.duracion_seg)
    const video  = parseVideoUrl(c.youtube_id)
    return `
    <li class="ed-item${c.visible ? '' : ' ed-oculto'}">
      <div class="ed-flechas">
        <button class="ed-flecha" data-ed="subir-clase" data-id="${esc(c.id)}" title="Subir" ${i === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up"></i></button>
        <button class="ed-flecha" data-ed="bajar-clase" data-id="${esc(c.id)}" title="Bajar" ${i === lista.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down"></i></button>
      </div>
      <div class="ed-num">${i + 1}</div>
      <div class="ed-main">
        <div class="ed-titulo">${iconoVideo(c)} ${esc(c.titulo)}</div>
        <div class="ed-meta">
          ${c.visible ? '<span class="sp sp-activo">Visible</span>' : '<span class="sp sp-oculto">Oculta</span>'}
          ${video?.tipo === 'youtube' && !c.duracion_seg ? '<span class="sp sp-pendiente" title="Sin duración el avance no se puede validar">Sin duración</span>' : ''}
          ${dur ? `<span>· ${dur}</span>` : ''}
          <span>· ${nRec} material${nRec === 1 ? '' : 'es'}</span>
          <span>· ${nQuiz ? nQuiz + ' pregunta' + (nQuiz === 1 ? '' : 's') + ' de quiz' : 'sin quiz'}</span>
          ${nAlum ? `<span>· ${nAlum} alumno${nAlum === 1 ? '' : 's'} con avance</span>` : ''}
        </div>
      </div>
      <div class="ed-acts">
        <button class="act-btn ab-ver" data-ed="quiz-clase" data-id="${esc(c.id)}"><i class="fa-solid fa-clipboard-question"></i> Quiz${nQuiz ? ' (' + nQuiz + ')' : ''}</button>
        <button class="act-btn ab-nota" data-ed="editar-clase" data-id="${esc(c.id)}"><i class="fa-solid fa-pen"></i> Editar</button>
        <button class="act-btn ${c.visible ? 'ab-desactivar' : 'ab-activar'}" data-ed="ver-clase" data-id="${esc(c.id)}">
          <i class="fa-solid ${c.visible ? 'fa-eye-slash' : 'fa-eye'}"></i> ${c.visible ? 'Ocultar' : 'Mostrar'}</button>
        <button class="act-btn ab-eliminar" data-ed="borrar-clase" data-id="${esc(c.id)}" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
      </div>
    </li>`
  }).join('')

  $('editor-cursos').innerHTML = `
    <div class="ed-toolbar">
      <div>
        <button class="ed-back" data-ed="volver-modulos"><i class="fa-solid fa-arrow-left"></i> Módulos de "${esc(curso.titulo)}"</button>
        <h3>${esc(mod.titulo)}</h3>
        <div class="ed-sub">Clases del módulo, en el orden en que las verá el alumno. Cada una puede tener un video, materiales y un quiz.</div>
      </div>
      <button class="btn btn-sm btn-grad" data-ed="nueva-clase"><i class="fa-solid fa-plus"></i> Nueva clase</button>
    </div>
    ${lista.length ? `<ul class="ed-list">${filas}</ul>`
                   : '<div class="empty-state"><i class="fa-solid fa-list"></i>Este módulo todavía no tiene clases</div>'}`
}

function filaMaterial(r = {}) {
  return `
    <div class="ed-mat">
      <input class="fi mat-nombre" maxlength="150" placeholder="Nombre (ej.: Guía del módulo)" value="${esc(r.nombre || '')}"/>
      <input class="fi mat-url" placeholder="Enlace de Drive o web" value="${esc(r.url || '')}"/>
      <button type="button" class="ed-flecha mat-quitar" title="Quitar"><i class="fa-solid fa-xmark"></i></button>
    </div>`
}

function abrirModalClase(clase) {
  const nuevo = !clase
  const recursos = Array.isArray(clase?.recursos) ? clase.recursos : []
  $('me-titulo').textContent = nuevo ? 'Nueva clase' : 'Editar clase'
  $('me-desc').textContent = `${ED.cursoActual?.titulo || ''} · ${ED.moduloActual?.titulo || ''}`
  $('me-form').innerHTML = `
    <div class="fg">
      <label class="fl" for="fl-titulo">Título de la clase *</label>
      <input class="fi" id="fl-titulo" maxlength="200" placeholder="Ej.: Sección 1: Conceptos de movilidad" value="${esc(clase?.titulo || '')}"/>
    </div>
    <div class="fg">
      <label class="fl" for="fl-video">Video (enlace de YouTube o de Google Drive)</label>
      <input class="fi" id="fl-video" placeholder="https://youtu.be/...  o  https://drive.google.com/file/d/..." value="${esc(clase?.youtube_id && clase.youtube_id !== 'XXXXXXXXXX' ? clase.youtube_id : '')}"/>
      <div class="ed-nota">Déjalo vacío si la clase es solo lectura o materiales. En YouTube usa videos "No listados" (no "Privados").</div>
      <div id="fl-estado" class="ed-video-estado"></div>
      <div id="fl-preview" class="ed-preview" hidden></div>
    </div>
    <div class="fg" id="fl-dur-wrap">
      <label class="fl" for="fl-dur">Duración del video</label>
      <input class="fi" id="fl-dur" style="max-width:140px" placeholder="mm:ss" value="${esc(fmtDur(clase?.duracion_seg))}"/>
      <div class="ed-nota">Se completa sola con YouTube. Sirve para saber si el alumno vio el video (80 %).</div>
    </div>
    <div class="fg">
      <label class="fl" for="fl-desc">Descripción (opcional)</label>
      <textarea id="fl-desc" maxlength="2000" placeholder="De qué trata la clase, qué debe revisar el alumno...">${esc(clase?.descripcion || '')}</textarea>
    </div>
    <div class="fg">
      <span class="fl">Materiales (PDF, Word, Excel, carpetas de Drive...)</span>
      <div id="fl-mats">${recursos.map(filaMaterial).join('')}</div>
      <button type="button" class="act-btn ab-ver" id="fl-add-mat" style="margin-top:6px"><i class="fa-solid fa-plus"></i> Agregar material</button>
      <div class="ed-nota">Los archivos de Drive deben estar compartidos como "Cualquier persona con el enlace".</div>
    </div>
    ${nuevo ? '' : `
    <div class="fg">
      <label class="fl" for="fl-modulo">Módulo</label>
      <select class="fi" id="fl-modulo">
        ${ED.modulos.map(m => `<option value="${esc(m.id)}" ${m.id === clase.module_id ? 'selected' : ''}>${esc(m.titulo)}</option>`).join('')}
      </select>
      <div class="ed-nota">Cámbialo si quieres mover la clase a otro módulo del curso.</div>
    </div>`}
    <div class="fg ed-checks">
      <label class="ed-check"><input type="checkbox" id="fl-visible" ${nuevo || clase.visible ? 'checked' : ''}/>
        <span>Visible para los alumnos<small>Si la ocultas, no se ve ni cuenta para el promedio. El avance de los alumnos se conserva.</small></span></label>
    </div>`

  $('fl-add-mat').addEventListener('click', () => {
    $('fl-mats').insertAdjacentHTML('beforeend', filaMaterial())
    $('fl-mats').lastElementChild.querySelector('.mat-nombre').focus()
  })
  $('fl-mats').addEventListener('click', (e) => {
    if (e.target.closest('.mat-quitar')) { e.target.closest('.ed-mat').remove(); ED.sucio = true }
  })

  const inp = $('fl-video')
  let t = null
  inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => revisarVideo(false), 500) })
  revisarVideo(true)

  ED.guardar = () => guardarClase(clase)
  abrirModal()
  $('fl-titulo').focus()
}

async function revisarVideo(inicial) {
  const token = ++ED.videoToken
  const raw   = $('fl-video')?.value.trim() || ''
  const v     = parseVideoUrl(raw)
  const est   = $('fl-estado'), prev = $('fl-preview'), durWrap = $('fl-dur-wrap')
  if (!est) return

  durWrap.hidden = v?.tipo !== 'youtube'
  if (!raw) { est.innerHTML = ''; prev.hidden = true; prev.innerHTML = ''; return }
  if (!v)   {
    est.innerHTML = '<span style="color:var(--red)"><i class="fa-solid fa-circle-exclamation"></i> No reconozco el enlace. Pega un enlace de YouTube o de Google Drive.</span>'
    prev.hidden = true; prev.innerHTML = ''; return
  }

  const src = v.tipo === 'youtube'
    ? `https://www.youtube.com/embed/${encodeURIComponent(v.id)}?rel=0`
    : `https://drive.google.com/file/d/${encodeURIComponent(v.id)}/preview`
  if (prev.dataset.src !== src) {
    prev.dataset.src = src
    prev.innerHTML = `<iframe src="${esc(src)}" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe>`
  }
  prev.hidden = false

  if (v.tipo === 'drive') {
    est.innerHTML = `<span style="color:#1a7a35"><i class="fa-brands fa-google-drive"></i> Archivo de Drive.</span>
      <div class="ed-nota"><strong style="color:var(--amber)"><i class="fa-solid fa-triangle-exclamation"></i> Importante:</strong>
      en Drive, el archivo debe estar compartido como <strong>"Cualquier persona con el enlace" → Lector</strong>.
      Si en la vista previa sale "Solicitar acceso", los alumnos tampoco podrán verlo.
      (Los archivos de Google Classroom suelen estar compartidos solo con los alumnos del aula.)<br>
      Drive no informa cuánto se vio: el alumno marcará la clase como completada.</div>`
    return
  }

  est.innerHTML = '<span style="color:var(--muted)"><i class="fa-solid fa-spinner fa-spin"></i> Revisando el video de YouTube...</span>'
  const r = await infoYouTube(v.id)
  if (token !== ED.videoToken || !$('fl-estado')) return
  if (r.error) {
    est.innerHTML = `<span style="color:var(--red)"><i class="fa-solid fa-circle-exclamation"></i> ${esc(r.error)}</span>`
    return
  }
  const durInp = $('fl-dur')
  if (r.duracion && (!inicial || !durInp.value)) durInp.value = fmtDur(r.duracion)
  est.innerHTML = `<span style="color:#1a7a35"><i class="fa-brands fa-youtube"></i> Video de YouTube correcto${r.duracion ? ' · ' + fmtDur(r.duracion) : ''}.</span>`
}

let ytApiPromise = null
function cargarYouTubeAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (!ytApiPromise) {
    ytApiPromise = new Promise(resolve => {
      const anterior = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => { anterior?.(); resolve(window.YT) }
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    })
  }
  return ytApiPromise
}

async function infoYouTube(videoId) {
  const YT = await cargarYouTubeAPI()
  return new Promise(resolve => {
    const caja = document.createElement('div')
    caja.style.cssText = 'position:absolute;left:-9999px;top:0;width:320px;height:180px'
    const div = document.createElement('div')
    caja.appendChild(div)
    document.body.appendChild(caja)
    let listo = false
    const terminar = (r) => {
      if (listo) return
      listo = true
      try { player.destroy() } catch {   }
      caja.remove()
      resolve(r)
    }
    const player = new YT.Player(div, {
      videoId,
      playerVars: { autoplay: 0, controls: 0 },
      events: {
        onReady: (e) => {
          let intentos = 0
          const leer = () => {
            const d = Math.round(e.target.getDuration?.() || 0)
            if (d > 0 || ++intentos > 15) terminar({ duracion: d })
            else setTimeout(leer, 300)
          }
          leer()
        },
        onError: (e) => {
          const msg = {
            2:   'El enlace del video no es válido.',
            5:   'El video no se puede reproducir en el navegador.',
            100: 'El video no existe, fue borrado o es "Privado". Usa "No listado".',
            101: 'El dueño del video no permite insertarlo en otras páginas. Actívalo en YouTube Studio (Permitir inserción).',
            150: 'El dueño del video no permite insertarlo en otras páginas. Actívalo en YouTube Studio (Permitir inserción).',
          }[e.data] || 'No se pudo revisar el video.'
          terminar({ error: msg })
        },
      },
    })
    setTimeout(() => terminar({ duracion: 0 }), 12000)
  })
}

async function guardarClase(clase) {
  const titulo = $('fl-titulo').value.trim()
  const raw    = $('fl-video').value.trim()
  const video  = parseVideoUrl(raw)
  if (!titulo)        { toast('Escribe el título de la clase', 'wa'); return false }
  if (raw && !video)  { toast('El enlace del video no es de YouTube ni de Google Drive', 'wa'); return false }

  const recursos = []
  for (const fila of document.querySelectorAll('#fl-mats .ed-mat')) {
    const nombre = fila.querySelector('.mat-nombre').value.trim()
    const url    = fila.querySelector('.mat-url').value.trim()
    if (!nombre && !url) continue
    if (!url || urlSegura(url) === '#' || !/^https?:\/\//i.test(url)) {
      toast(`El material "${nombre || 'sin nombre'}" necesita un enlace que empiece con https://`, 'wa', 6000); return false
    }
    recursos.push({ nombre: nombre || 'Material', url, tipo: tipoRecurso(url) })
  }

  const datos = {
    titulo,
    youtube_id:   raw || null,
    duracion_seg: video?.tipo === 'youtube' ? leerDur($('fl-dur').value) : 0,
    descripcion:  $('fl-desc').value.trim() || null,
    recursos,
    visible:      $('fl-visible').checked,
  }

  let error
  if (clase) {
    const nuevoModulo = $('fl-modulo')?.value
    if (nuevoModulo && nuevoModulo !== clase.module_id) {
      const { data: ult } = await supabase.from('classes').select('orden')
        .eq('module_id', nuevoModulo).order('orden', { ascending: false }).limit(1)
      datos.module_id = nuevoModulo
      datos.orden = (ult?.[0]?.orden || 0) + 1
    }
    ;({ error } = await supabase.from('classes').update(datos).eq('id', clase.id))
  } else {
    datos.module_id = ED.moduloActual.id
    datos.orden = Math.max(0, ...ED.clases.map(c => c.orden || 0)) + 1
    ;({ error } = await supabase.from('classes').insert(datos))
  }
  if (error) { toast('No se pudo guardar: ' + msgError(error), 'wa', 6000); return false }

  if (datos.module_id && datos.module_id !== ED.moduloActual.id) {
    toast('Clase movida a "' + (ED.modulos.find(m => m.id === datos.module_id)?.titulo || 'otro módulo') + '"', 'ok', 5000)
  } else {
    toast(clase ? 'Clase actualizada' : 'Clase creada', 'ok')
  }
  if (video?.tipo === 'youtube' && !datos.duracion_seg) {
    toast('Guardada, pero sin duración: el avance de este video no se podrá validar. Escribe la duración (mm:ss).', 'wa', 8000)
  }
  await recargarClases()
  return true
}

async function alternarClase(id) {
  const c = ED.clases.find(x => x.id === id)
  if (!c) return
  if (c.visible && !confirm(`¿Ocultar "${c.titulo}"? Los alumnos no la verán y no contará para el promedio. Su avance se conserva y puedes volver a mostrarla.`)) return
  const { error } = await supabase.from('classes').update({ visible: !c.visible }).eq('id', id)
  if (error) { toast('No se pudo cambiar: ' + msgError(error), 'wa', 6000); return }
  toast(c.visible ? 'Clase oculta' : 'Clase visible', 'ok')
  await recargarClases()
}

async function borrarClase(id) {
  const c = ED.clases.find(x => x.id === id)
  if (!c) return
  const nAlum = c.progress?.[0]?.count || 0
  if (nAlum > 0) {
    toast(`${nAlum} alumno(s) ya avanzaron en esta clase, no se puede borrar. Usa "Ocultar".`, 'wa', 7000)
    return
  }
  const nQuiz = c.nPreguntas || 0
  if (!confirm(`¿Eliminar la clase "${c.titulo}"${nQuiz ? ` y sus ${nQuiz} pregunta(s) de quiz` : ''}? No se puede deshacer.`)) return
  const { error, count } = await supabase.from('classes').delete({ count: 'exact' }).eq('id', id)
  if (error)  { toast('No se pudo eliminar: ' + msgError(error), 'wa', 8000); return }
  if (!count) { toast('No se eliminó la clase (revisa tus permisos).', 'wa', 6000); return }
  toast('Clase eliminada', 'ok')
  await recargarClases()
}

const LETRAS = ['A', 'B', 'C', 'D']
let uidPregunta = 0

function bloquePregunta(p = {}) {
  const uid  = ++uidPregunta
  const opc  = Array.isArray(p.opciones) ? p.opciones : []
  return `
    <div class="ed-preg" data-id="${esc(p.id || '')}">
      <div class="ed-preg-cab">
        <strong class="ed-preg-num">Pregunta</strong>
        <span class="ed-preg-acts">
          <button type="button" class="ed-flecha" data-q="subir" title="Subir"><i class="fa-solid fa-chevron-up"></i></button>
          <button type="button" class="ed-flecha" data-q="bajar" title="Bajar"><i class="fa-solid fa-chevron-down"></i></button>
          <button type="button" class="ed-flecha" data-q="quitar" title="Quitar pregunta"><i class="fa-solid fa-xmark"></i></button>
        </span>
      </div>
      <textarea class="fq-texto" rows="2" maxlength="1000" placeholder="Escribe la pregunta...">${esc(p.pregunta || '')}</textarea>
      <div class="ed-opcs">
        ${LETRAS.map((l, i) => `
          <label class="ed-opc" title="Marca la respuesta correcta">
            <input type="radio" name="fq-ok-${uid}" value="${i}" ${p.respuesta_correcta === i ? 'checked' : ''}/>
            <span class="ed-letra">${l}</span>
            <input class="fi fq-opcion" maxlength="400" placeholder="Opción ${l}${i >= 2 ? ' (opcional)' : ''}" value="${esc(opc[i] ?? '')}"/>
          </label>`).join('')}
      </div>
    </div>`
}

function renumerarPreguntas() {
  const bloques = [...document.querySelectorAll('#fq-lista .ed-preg')]
  bloques.forEach((b, i) => {
    b.querySelector('.ed-preg-num').textContent = `Pregunta ${i + 1}`
    b.querySelector('[data-q="subir"]').disabled = i === 0
    b.querySelector('[data-q="bajar"]').disabled = i === bloques.length - 1
  })
  const vacio = $('fq-vacio')
  if (vacio) vacio.hidden = bloques.length > 0
}

async function abrirModalQuiz(clase) {
  if (!clase) return
  $('me-titulo').textContent = 'Quiz de la clase'
  $('me-desc').textContent = clase.titulo
  $('me-form').innerHTML = '<div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> Cargando preguntas...</div>'
  ED.guardar = null
  abrirModal()

  const [{ data: preguntas, error }, { count: rendidos }] = await Promise.all([
    supabase.rpc('admin_quiz_preguntas', { p_class_id: clase.id }),
    supabase.from('quiz_results').select('id', { count: 'exact', head: true }).eq('class_id', clase.id),
  ])
  if (!$('modal-editor').classList.contains('open')) return
  if (error) {
    $('me-form').innerHTML = `<div class="empty-state">No se pudieron cargar las preguntas: ${esc(error.message)}</div>`
    return
  }
  const originales = preguntas || []

  $('me-form').innerHTML = `
    ${rendidos ? `
      <div class="ed-aviso">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <div><strong>${rendidos} alumno${rendidos === 1 ? ' ya rindió' : 's ya rindieron'} este quiz.</strong>
        Sus notas se mantienen. Si cambias las preguntas, el cambio solo aplica a quienes todavía no lo rinden.</div>
      </div>` : ''}
    <div class="ed-nota" style="margin:0 0 12px">
      Escribe cada pregunta, sus opciones (mínimo 2, máximo 4) y <strong>marca con el círculo la respuesta correcta</strong>.
      La nota se calcula sobre 20. El alumno lo rinde una sola vez, después de ver la clase.
    </div>
    <div id="fq-lista">${originales.map(bloquePregunta).join('')}</div>
    <div id="fq-vacio" class="empty-state" style="padding:24px" ${originales.length ? 'hidden' : ''}>
      Esta clase no tiene quiz. Agrega la primera pregunta.</div>
    <button type="button" class="act-btn ab-ver" id="fq-agregar" style="margin-top:8px">
      <i class="fa-solid fa-plus"></i> Agregar pregunta</button>`
  renumerarPreguntas()

  $('fq-agregar').addEventListener('click', () => {
    $('fq-lista').insertAdjacentHTML('beforeend', bloquePregunta())
    renumerarPreguntas()
    ED.sucio = true
    const ult = $('fq-lista').lastElementChild
    ult.scrollIntoView({ behavior: 'smooth', block: 'center' })
    ult.querySelector('.fq-texto').focus()
  })
  $('fq-lista').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]')
    if (!b) return
    const bloque = b.closest('.ed-preg')
    if (b.dataset.q === 'quitar') {
      const txt = bloque.querySelector('.fq-texto').value.trim()
      if (txt && !confirm('¿Quitar esta pregunta?')) return
      bloque.remove()
    } else if (b.dataset.q === 'subir' && bloque.previousElementSibling) {
      bloque.parentNode.insertBefore(bloque, bloque.previousElementSibling)
    } else if (b.dataset.q === 'bajar' && bloque.nextElementSibling) {
      bloque.parentNode.insertBefore(bloque.nextElementSibling, bloque)
    }
    ED.sucio = true
    renumerarPreguntas()
  })

  ED.guardar = () => guardarQuiz(clase, originales)
}

async function guardarQuiz(clase, originales) {

  const preguntas = []
  const bloques = [...document.querySelectorAll('#fq-lista .ed-preg')]
  for (const [i, b] of bloques.entries()) {
    const texto = b.querySelector('.fq-texto').value.trim()
    const campos = [...b.querySelectorAll('.fq-opcion')].map(x => x.value.trim())
    const marcada = b.querySelector('input[type="radio"]:checked')
    const n = i + 1
    if (!texto) { toast(`La pregunta ${n} está vacía`, 'wa'); return false }

    const opciones = [], mapa = {}
    campos.forEach((v, k) => { if (v) { mapa[k] = opciones.length; opciones.push(v) } })
    if (opciones.length < 2) { toast(`La pregunta ${n} necesita al menos 2 opciones`, 'wa'); return false }
    if (!marcada) { toast(`Marca la respuesta correcta de la pregunta ${n}`, 'wa'); return false }
    const correcta = mapa[Number(marcada.value)]
    if (correcta === undefined) { toast(`En la pregunta ${n}, la respuesta marcada está vacía`, 'wa'); return false }

    preguntas.push({ id: b.dataset.id || null, pregunta: texto, opciones, respuesta_correcta: correcta, orden: n })
  }

  const quedan  = new Set(preguntas.filter(p => p.id).map(p => p.id))
  const borrar  = originales.filter(o => !quedan.has(o.id)).map(o => o.id)
  const puntos  = preguntas.length ? Math.round(20 / preguntas.length) : 0
  const ops = []
  if (borrar.length) ops.push(supabase.from('quiz_questions').delete().in('id', borrar))
  for (const p of preguntas) {
    const datos = { pregunta: p.pregunta, opciones: p.opciones, respuesta_correcta: p.respuesta_correcta, orden: p.orden, puntos }
    ops.push(p.id
      ? supabase.from('quiz_questions').update(datos).eq('id', p.id)
      : supabase.from('quiz_questions').insert({ ...datos, class_id: clase.id }))
  }
  const res = await Promise.all(ops)
  const fallo = res.find(r => r.error)
  if (fallo) {
    toast('No se pudo guardar todo el quiz: ' + msgError(fallo.error) + '. Vuelve a abrirlo para revisar.', 'wa', 8000)
    await recargarClases()
    return false
  }

  toast(preguntas.length ? `Quiz guardado (${preguntas.length} pregunta${preguntas.length === 1 ? '' : 's'})` : 'Quiz eliminado', 'ok')
  await recargarClases()
  return true
}

async function mover(lista, id, delta, tabla, recargar) {
  const i = lista.findIndex(x => x.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= lista.length) return
  const nueva = [...lista]
  ;[nueva[i], nueva[j]] = [nueva[j], nueva[i]]
  const cambios = nueva
    .map((x, k) => ({ id: x.id, orden: k + 1, antes: x.orden }))
    .filter(x => x.orden !== x.antes)
  const resultados = await Promise.all(
    cambios.map(x => supabase.from(tabla).update({ orden: x.orden }).eq('id', x.id))
  )
  const fallo = resultados.find(r => r.error)
  if (fallo) toast('No se pudo cambiar el orden: ' + msgError(fallo.error), 'wa', 6000)
  await recargar()
}

function abrirModal() {
  ED.sucio = false
  $('modal-editor').classList.add('open')
}

function cerrarModal(forzar = false) {
  if (!$('modal-editor').classList.contains('open')) return
  if (!forzar && ED.sucio && !confirm('Tienes cambios sin guardar. ¿Salir sin guardar?')) return
  $('modal-editor').classList.remove('open')
  ED.guardar = null
  ED.videoToken++
  $('me-form').innerHTML = ''
}

initEditor()
