import {
  supabase, cerrarSesion, getUsuario, getPerfil, actualizarPerfil,
  loginConGoogle,
  getCursos, getCurso, getModulos, getClasesDelCurso,
  getProgreso, getMisClases, getMiResultado, registrarAvance, reiniciarCurso,
  getQuizPreguntas, calificarQuiz, iniciarQuiz, guardarRespuestasQuiz, finalizarMisQuizzesVencidos,
  entregarTrabajo, getExamen, enviarConsulta, getConsultas,
  getMisMatriculas, getMatricula, matricularse, marcarEnProgreso
} from './supabase.js?v=202611060003'

import {
  esc, urlSegura, toast, initials, formatFecha,
  PERFIL_LABELS, cargando, traducirErrorAuth, parseVideoUrl,
  mostrarCarga, ocultarCarga, portadaUrl
} from './utils.js?v=202611060003'

const STATE = {
  usuario: null, perfil: null,
  cursoActual: null, moduloActual: null, claseActual: null,
  modulos: [], todasClases: [], clases: [], progreso: [],
  estados: new Map(), resultado: null, trabajo: null,
  cursoParaMatricular: null,
  quizPreguntas: [], quizRespuestas: [],
  quizPreguntaActual: 0, quizOpcionSeleccionada: null, quizTerminado: false, quizAvanzando: false,
  timerInterval: null, timerSegundos: 600,

  player: null, videoInterval: null, seguimiento: null, cargaId: 0,
}

const NOTA_MINIMA = 12
const GUARDAR_CADA_SEG = 15
const UMBRAL_COMPLETADO = 0.8

function initLanding() {

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) window.location.href = 'catalogo.html'
  })

  const err = new URLSearchParams(location.hash.slice(1)).get('error_description')
           || new URLSearchParams(location.search).get('error_description')
  if (err) toast('No se pudo ingresar con Google: ' + err, 'wa', 7000)

  document.getElementById('btn-google')?.addEventListener('click', async (e) => {
    const restaurar = cargando(e.currentTarget, 'Conectando con Google...')
    const { error } = await loginConGoogle()
    if (error) { restaurar(); toast(traducirErrorAuth(error), 'wa', 6000) }

  })
}

const CAMPOS_OBLIGATORIOS = ['perfil', 'full_name', 'dni', 'cargo', 'institucion']
const perfilCompleto = (p) => CAMPOS_OBLIGATORIOS.every(c => p?.[c] && String(p[c]).trim())

async function initPerfil() {
  const usuario = await getUsuario()
  if (!usuario) { window.location.href = 'index.html'; return }
  let perfil = await getPerfil(usuario.id)
  if (!perfil) {
    ocultarCarga()
    toast('No encontramos tu perfil. Intenta ingresar de nuevo.', 'wa', 6000)
    setTimeout(cerrarSesion, 2500); return
  }
  if (perfil.es_admin || perfil.es_profesor) { window.location.href = 'admin.html'; return }

  const meta     = usuario.user_metadata || {}
  const completo = perfilCompleto(perfil)
  const $ = (id) => document.getElementById(id)

  $('pf-email').textContent = usuario.email
  const nombreBase = perfil.full_name || meta.full_name || meta.name || ''
  $('pf-initials').textContent = initials(nombreBase)
  const foto = meta.avatar_url || meta.picture
  if (foto) { $('pf-avatar').src = foto; $('pf-avatar').hidden = false; $('pf-initials').hidden = true }

  if (completo) {
    $('pf-titulo').textContent = 'Mi perfil'
    $('pf-intro').hidden = true
    $('btn-guardar-txt').textContent = 'Guardar cambios'
    if (perfil.estado === 'activo') $('btn-volver').hidden = false
  }

  if (perfil.perfil) {
    $('sec-perfil').hidden = true
    $('sec-perfil-fijo').hidden = false
    $('pf-perfil-label').textContent = PERFIL_LABELS[perfil.perfil] || perfil.perfil
  }

  const avisos = {
    pendiente: completo ? ['fa-hourglass-half', 'Tu solicitud está en revisión. Puedes corregir tus datos mientras tanto.'] : null,
    rechazado: ['fa-circle-xmark', 'Tu solicitud no fue aprobada. Corrige tus datos o comunícate con el equipo PROMOVILIDAD.'],
    inactivo:  ['fa-ban', 'Tu cuenta está desactivada. Comunícate con el equipo PROMOVILIDAD.'],
  }
  const aviso = avisos[perfil.estado]
  if (aviso) {
    $('pf-estado').hidden = false
    $('pf-estado').innerHTML = `<i class="fa-solid ${aviso[0]}"></i><span>${esc(aviso[1])}</span>`
  }

  const campos = {
    'f-nombre': nombreBase, 'f-dni': perfil.dni, 'f-fecha': perfil.fecha_nacimiento,
    'f-lugar': perfil.lugar_nacimiento, 'f-cargo': perfil.cargo, 'f-inst': perfil.institucion,
    'f-ciudad': perfil.ciudad, 'f-dpto': perfil.departamento,
  }
  Object.entries(campos).forEach(([id, v]) => { if ($(id) && v) $(id).value = v })
  ocultarCarga()
  $('f-dni')?.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '') })

  document.querySelectorAll('#pf-opciones input[name="perfil"]').forEach(r => {
    r.addEventListener('change', () => {
      document.querySelectorAll('#pf-opciones .pf-row').forEach(l => {
        l.classList.toggle('sel', l.querySelector('input').checked)
      })
    })
  })

  $('btn-salir')?.addEventListener('click', cerrarSesion)

  $('btn-guardar')?.addEventListener('click', async (e) => {
    const val = (id) => $(id)?.value.trim() || ''
    const datos = {
      full_name:        val('f-nombre'),
      dni:              val('f-dni'),
      fecha_nacimiento: val('f-fecha') || null,
      lugar_nacimiento: val('f-lugar') || null,
      cargo:            val('f-cargo'),
      institucion:      val('f-inst'),
      ciudad:           val('f-ciudad') || null,
      departamento:     val('f-dpto') || null,
    }
    if (!perfil.perfil) {
      const elegido = document.querySelector('#pf-opciones input[name="perfil"]:checked')?.value
      if (!elegido) { toast('Elige a qué perfil perteneces', 'wa'); return }
      datos.perfil = elegido
    }
    if (!datos.full_name || !datos.dni || !datos.cargo || !datos.institucion) {
      toast('Completa todos los campos obligatorios (*)', 'wa'); return
    }
    if (!/^\d{8,12}$/.test(datos.dni)) { toast('DNI/CE debe tener entre 8 y 12 dígitos', 'wa'); return }

    const restaurar = cargando(e.currentTarget, 'Guardando...')
    const { error } = await actualizarPerfil(usuario.id, datos)
    restaurar()
    if (error) {
      const msg = /profiles_dni_key|duplicate/i.test(error.message)
        ? 'Ese DNI ya está registrado en otra cuenta. Si es tuyo, comunícate con el equipo PROMOVILIDAD.'
        : error.message
      toast(msg, 'wa', 7000); return
    }

    perfil = { ...perfil, ...datos }
    if (perfil.estado === 'activo') toast('Datos actualizados', 'ok')
    else window.location.href = 'pendiente.html'
  })
}

async function initPendiente() {
  const usuario = await getUsuario()
  if (!usuario) { window.location.href = 'index.html'; return }
  const perfil = await getPerfil(usuario.id)
  if (!perfil) { await cerrarSesion(); return }
  if (perfil.es_admin || perfil.es_profesor)            { window.location.href = 'admin.html';    return }
  if (!perfilCompleto(perfil))    { window.location.href = 'perfil.html';   return }
  if (perfil.estado === 'activo') { window.location.href = 'catalogo.html'; return }

  document.getElementById('pend-perfil').textContent = PERFIL_LABELS[perfil.perfil] || perfil.perfil
  document.getElementById('pend-email').textContent  = usuario.email

  if (perfil.estado === 'rechazado' || perfil.estado === 'inactivo') {
    const rechazado = perfil.estado === 'rechazado'
    document.getElementById('pend-icono').innerHTML = `<i class="fa-solid ${rechazado ? 'fa-circle-xmark' : 'fa-ban'}"></i>`
    document.getElementById('pend-titulo').textContent = rechazado ? 'Solicitud no aprobada' : 'Cuenta desactivada'
    document.getElementById('pend-texto').textContent = rechazado
      ? 'No pudimos verificar tus datos. Corrígelos o comunícate con el equipo PROMOVILIDAD.'
      : 'Tu cuenta fue desactivada. Comunícate con el equipo PROMOVILIDAD para reactivarla.'
    document.getElementById('pend-pasos').hidden = true
  }
  ocultarCarga()

  document.getElementById('btn-salir')?.addEventListener('click', cerrarSesion)
  document.getElementById('btn-revisar')?.addEventListener('click', async (e) => {
    const restaurar = cargando(e.currentTarget, 'Revisando...')
    const p = await getPerfil(usuario.id)
    restaurar()
    if (p?.estado === 'activo') {
      toast('¡Tu cuenta ya está activa!', 'ok')
      setTimeout(() => { window.location.href = 'catalogo.html' }, 900)
    } else {
      toast('Tu solicitud sigue en revisión. Vuelve a intentarlo más tarde.')
    }
  })
}

async function exigirAlumnoActivo() {
  const usuario = await getUsuario()
  if (!usuario) { window.location.href = 'index.html'; return null }

  const perfil = await getPerfil(usuario.id)
  if (!perfil) { await cerrarSesion(); return null }
  if (perfil.es_admin || perfil.es_profesor) { window.location.href = 'admin.html'; return null }

  if (!perfilCompleto(perfil))    { window.location.href = 'perfil.html';    return null }
  if (perfil.estado !== 'activo') { window.location.href = 'pendiente.html'; return null }

  STATE.usuario = usuario
  STATE.perfil  = perfil
  return { usuario, perfil }
}

async function initCatalogo() {
  const sesion = await exigirAlumnoActivo()
  if (!sesion) return
  const { usuario, perfil } = sesion

  const label = PERFIL_LABELS[perfil.perfil] || perfil.perfil || ''
  document.getElementById('cat-initials').textContent  = initials(perfil.full_name)
  document.getElementById('cat-nombre').textContent    = perfil.full_name || usuario.email
  document.getElementById('cat-perfil').textContent    = label
  document.getElementById('cat-subtitulo').textContent = `Cursos disponibles para ${label}`
  const nombre1 = (perfil.full_name || '').trim().split(/\s+/)[0]
  document.getElementById('cat-saludo').textContent = nombre1 ? `Hola, ${nombre1}` : 'Hola'
  document.getElementById('btn-salir')?.addEventListener('click', cerrarSesion)

  const cerrarModal = () => {
    document.getElementById('modal-overlay').classList.remove('open')
    STATE.cursoParaMatricular = null
  }
  document.getElementById('modal-cancelar')?.addEventListener('click', cerrarModal)
  document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') cerrarModal()
  })
  document.getElementById('modal-confirmar')?.addEventListener('click', async (e) => {
    if (!STATE.cursoParaMatricular) return
    const restaurar = cargando(e.currentTarget, 'Matriculando...')
    const { error } = await matricularse(STATE.usuario.id, STATE.cursoParaMatricular.id)
    restaurar()
    if (error) { toast('Error al matricularse. Intenta de nuevo.', 'wa'); return }
    toast('¡Te matriculaste correctamente!', 'ok')
    cerrarModal()
    await cargarCatalogo()
  })

  document.querySelector('.cat-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-accion]')
    if (!btn) return
    const { accion, id, titulo } = btn.dataset
    if (accion === 'ingresar') irAlCurso(id, titulo)
    if (accion === 'matricular') abrirModalMatricula(id, titulo)
  })

  await cargarCatalogo()
  ocultarCarga()
}

async function cargarCatalogo() {
  const [cursos, matriculas] = await Promise.all([
    getCursos(STATE.perfil.perfil),
    getMisMatriculas(STATE.usuario.id),
  ])
  const mapM    = Object.fromEntries(matriculas.map(m => [m.course_id, m]))
  const cursosM = cursos.filter(c =>  mapM[c.id])
  const cursosD = cursos.filter(c => !mapM[c.id])

  const resultados = await Promise.all(cursosM.map(c => getMiResultado(c.id)))
  const mapR = Object.fromEntries(cursosM.map((c, i) => [c.id, resultados[i]]))
  const aprobado = (c) => mapR[c.id]?.estado === 'aprobado' || (!mapR[c.id] && mapM[c.id].estado === 'completado')

  document.getElementById('stat-encurso').textContent      = cursosM.filter(c => !aprobado(c)).length
  document.getElementById('stat-completados').textContent  = cursosM.filter(aprobado).length
  document.getElementById('stat-disponibles').textContent  = cursosD.length

  const datos = (c) => `data-id="${esc(c.id)}" data-titulo="${esc(c.titulo)}"`
  const tarjeta = (c, chip, cuerpoExtra, pie) => `
    <article class="cur-card">
      <div class="cur-cover">${portadaHtml(c)}${chip}</div>
      <div class="cur-body">
        <h3 class="cur-tit">${esc(c.titulo)}</h3>
        <p class="cur-desc">${esc(c.descripcion || 'Curso de formación PROMOVILIDAD')}</p>
        ${cuerpoExtra}
      </div>
      <div class="cur-pie">${pie}</div>
    </article>`

  const secM  = document.getElementById('sec-matriculados')
  const gridM = document.getElementById('grid-matriculados')
  if (cursosM.length > 0) {
    secM.style.display = 'block'
    gridM.innerHTML = cursosM.map(c => {
      const r      = mapR[c.id]
      const total  = r?.total_clases || 0
      const hechas = r?.clases_completadas || 0
      const pct    = total ? Math.round(hechas / total * 100) : 0
      const estado = r?.estado || (mapM[c.id].estado === 'completado' ? 'aprobado' : 'en_curso')
      const [chipCls, chipTxt] = chipEstadoCurso(estado, r?.trabajo_estado, hechas)
      const progreso = r ? `
        <div class="cur-prog">
          <div class="cur-prog-bar${estado === 'aprobado' ? ' lleno' : ''}"><span style="width:${pct}%"></span></div>
          <div class="cur-prog-txt"><span>${hechas} de ${total} clase${total === 1 ? '' : 's'}</span><strong>${pct} %</strong></div>
        </div>` : ''
      const boton =
          estado === 'aprobado'    ? `<button class="btn cur-btn" data-accion="ingresar" ${datos(c)}><i class="fa-solid fa-rotate-left"></i> Repasar</button>`
        : estado === 'desaprobado' ? `<button class="btn cur-btn" data-accion="ingresar" ${datos(c)}><i class="fa-solid fa-chart-simple"></i> Ver mi resultado</button>`
        : `<button class="btn btn-dark cur-btn" data-accion="ingresar" ${datos(c)}><i class="fa-solid fa-play"></i> ${hechas > 0 ? 'Continuar' : 'Empezar'}</button>`
      return tarjeta(c, `<span class="cur-chip ${chipCls}">${chipTxt}</span>`, progreso, boton)
    }).join('')
  } else {
    secM.style.display = 'none'
  }

  const gridD = document.getElementById('grid-disponibles')
  if (cursosD.length > 0) {
    gridD.innerHTML = cursosD.map(c => tarjeta(c, '', '',
      `<button class="btn btn-dark cur-btn" data-accion="matricular" ${datos(c)}><i class="fa-solid fa-plus"></i> Matricularme</button>`
    )).join('')
  } else {
    gridD.innerHTML = `<p style="font-size:13px;color:var(--muted);padding:16px 0">${
      cursos.length ? 'Ya estás matriculado en todos los cursos disponibles.' : 'Todavía no hay cursos publicados para tu perfil.'
    }</p>`
  }
}

function abrirModalMatricula(courseId, titulo) {
  STATE.cursoParaMatricular = { id: courseId, titulo }
  document.getElementById('modal-titulo').textContent = '¿Matricularte en este curso?'
  document.getElementById('modal-desc').textContent   = `"${titulo}". Tendrás acceso a las clases y los quizzes. Al aprobar el curso obtendrás tu constancia de participación.`
  document.getElementById('modal-overlay').classList.add('open')
}

function chipEstadoCurso(estado, trabajoEstado, hechas) {
  if (estado === 'aprobado')    return ['ch-verde', 'Aprobado']
  if (estado === 'desaprobado') return ['ch-rojo',  'Desaprobado']
  if (estado === 'falta_trabajo') {
    if (trabajoEstado === 'pendiente')   return ['ch-azul',  'Trabajo en revisión']
    if (trabajoEstado === 'desaprobado') return ['ch-ambar', 'Trabajo observado']
    return ['ch-ambar', 'Falta trabajo final']
  }
  return hechas > 0 ? ['ch-azul', 'En progreso'] : ['ch-azul', 'Matriculado']
}

function portadaHtml(curso) {
  const url = portadaUrl(curso)
  return url
    ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.remove()"/>`
    : ''
}

function irAlCurso(courseId, titulo) {
  sessionStorage.setItem('curso_id',     courseId)
  sessionStorage.setItem('curso_titulo', titulo)
  window.location.href = 'curso.html?curso=' + encodeURIComponent(courseId)
}

async function initCurso() {
  const sesion = await exigirAlumnoActivo()
  if (!sesion) return
  const { usuario, perfil } = sesion
  const $ = (id) => document.getElementById(id)
  $('det-initials').textContent = initials(perfil.full_name)
  $('det-nombre').textContent   = perfil.full_name || usuario.email
  $('det-perfil').textContent   = PERFIL_LABELS[perfil.perfil] || perfil.perfil || ''
  $('btn-salir')?.addEventListener('click', cerrarSesion)

  const courseId = new URLSearchParams(location.search).get('curso') || sessionStorage.getItem('curso_id')
  if (!courseId) { window.location.href = 'catalogo.html'; return }

  await finalizarMisQuizzesVencidos()
  const [curso, matricula, modulos] = await Promise.all([
    getCurso(courseId), getMatricula(usuario.id, courseId), getModulos(courseId),
  ])
  if (!curso || !matricula) {
    ocultarCarga()
    alert('No estás matriculado en este curso.')
    window.location.href = 'catalogo.html'; return
  }
  sessionStorage.setItem('curso_id', courseId)
  sessionStorage.setItem('curso_titulo', curso.titulo)
  STATE.cursoActual = curso
  STATE.modulos     = [...modulos].sort(ordenModulo)
  STATE.clasesCurso = await getClasesDelCurso(STATE.modulos.map(m => m.id))
  STATE.refrescar   = refrescarDetalle

  initAccionesCurso()
  await refrescarDetalle()
  ocultarCarga()
}

async function refrescarDetalle() {
  const cid = STATE.cursoActual.id
  const [estados, resultado, trabajo] = await Promise.all([
    getMisClases(cid), getMiResultado(cid), getExamen(STATE.usuario.id, cid),
  ])
  STATE.estados   = new Map(estados.map(e => [e.class_id, e]))
  STATE.resultado = resultado
  STATE.trabajo   = trabajo

  const pos = (c) => STATE.estados.get(c.id)?.posicion ?? 1e9
  STATE.todasClases = [...STATE.clasesCurso].sort((a, b) => pos(a) - pos(b))
  renderDetalle()
  renderResultado()
  renderTrabajo()
}

const minutosDe = (seg) => Math.max(1, Math.round((seg || 0) / 60))
function duracionTexto(seg) {
  const min = Math.round((seg || 0) / 60)
  if (!min) return ''
  const h = Math.floor(min / 60), m = min % 60
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`
}

function renderDetalle() {
  const $ = (id) => document.getElementById(id)
  const curso  = STATE.cursoActual
  const r      = STATE.resultado
  const clases = STATE.todasClases
  const cid    = encodeURIComponent(curso.id)
  const enlaceClase = (c) => `aula.html?curso=${cid}&clase=${encodeURIComponent(c.id)}`

  document.title = `${curso.titulo} · PROMOVILIDAD`
  $('det-titulo').textContent = curso.titulo
  $('det-desc').textContent   = curso.descripcion || 'Curso de formación PROMOVILIDAD'
  $('det-regla-trabajo').hidden = !curso.requiere_trabajo

  const portada = $('det-portada')
  const url = portadaUrl(curso)
  portada.querySelector('img')?.remove()
  if (url) {
    const img = document.createElement('img')
    img.src = url; img.alt = ''
    img.onerror = () => img.remove()
    portada.prepend(img)
  }

  const total  = r?.total_clases ?? clases.length
  const hechas = r?.clases_completadas ?? clases.filter(c => est(c)?.hecha).length
  const pct    = total ? Math.round(hechas / total * 100) : 0
  $('det-anillo').style.setProperty('--p', pct)
  $('det-anillo').classList.toggle('lleno', r?.estado === 'aprobado')
  $('det-pct').textContent = `${pct} %`
  $('det-prog-clases').textContent  = `${hechas} de ${total} clase${total === 1 ? '' : 's'}`
  $('det-prog-quizzes').textContent = r?.total_quizzes ? `${r.quizzes_rendidos} de ${r.total_quizzes} quizzes` : ''

  const [chipCls, chipTxt] = chipEstadoCurso(r?.estado || 'en_curso', r?.trabajo_estado, hechas)
  $('det-chip').className   = `cur-chip det-chip ${chipCls}`
  $('det-chip').textContent = chipTxt

  const segTotal = clases.reduce((s, c) => s + (c.duracion_seg || 0), 0)
  const nQuizzes = clases.filter(c => est(c)?.tiene_quiz).length
  const meta = [
    `<li><i class="fa-solid fa-layer-group"></i> ${STATE.modulos.length} módulo${STATE.modulos.length === 1 ? '' : 's'}</li>`,
    `<li><i class="fa-regular fa-circle-play"></i> ${clases.length} clase${clases.length === 1 ? '' : 's'}</li>`,
    segTotal ? `<li><i class="fa-regular fa-clock"></i> ${duracionTexto(segTotal)} de video</li>` : '',
    nQuizzes ? `<li><i class="fa-regular fa-circle-question"></i> ${nQuizzes} quiz${nQuizzes === 1 ? '' : 'zes'}</li>` : '',
  ]
  $('det-meta').innerHTML = meta.join('')

  const abiertas  = clases.filter(c => est(c)?.desbloqueada)
  const siguiente = abiertas.find(c => !est(c).hecha)
  const btn = $('det-continuar')
  const txt = btn.querySelector('span')
  btn.classList.remove('deshabilitado')
  if (!clases.length) {
    txt.textContent = 'Pronto habrá clases'
    btn.removeAttribute('href'); btn.classList.add('deshabilitado')
    $('det-siguiente').textContent = ''
  } else if (siguiente && r?.estado !== 'aprobado') {
    txt.textContent = hechas > 0 ? 'Continuar donde lo dejé' : 'Empezar el curso'
    btn.href = enlaceClase(siguiente)
    $('det-siguiente').textContent = `Sigue: ${siguiente.titulo}`
  } else {
    txt.textContent = 'Repasar el curso'
    btn.href = `aula.html?curso=${cid}`
    $('det-siguiente').textContent = ''
  }

  const cont = $('det-modulos')
  if (!STATE.modulos.length) {
    cont.innerHTML = '<div class="det-vacio">Este curso todavía no tiene módulos publicados.</div>'
    return
  }
  cont.innerHTML = STATE.modulos.map((m, i) => {
    const cm      = clases.filter(c => c.module_id === m.id)
    const hechasM = cm.filter(c => est(c)?.hecha).length
    const lock    = cm.length > 0 && cm.every(c => !est(c)?.desbloqueada)
    const done    = cm.length > 0 && hechasM === cm.length
    const actual  = !!siguiente && siguiente.module_id === m.id
    const pctM    = cm.length ? Math.round(hechasM / cm.length * 100) : 0
    const segM    = cm.reduce((s, c) => s + (c.duracion_seg || 0), 0)
    const quizM   = cm.filter(c => est(c)?.tiene_quiz).length
    const [eCls, eTxt] = done ? ['ch-verde', 'Completado']
                       : lock ? ['ch-gris', 'Bloqueado']
                       : (hechasM > 0 || actual) ? ['ch-azul', 'En progreso']
                       : ['ch-gris', 'Pendiente']
    const num = done ? '<i class="fa-solid fa-check"></i>'
              : lock ? '<i class="fa-solid fa-lock"></i>'
              : String(i + 1).padStart(2, '0')
    const metaM = [`${cm.length} clase${cm.length === 1 ? '' : 's'}`]
    if (segM)  metaM.push(duracionTexto(segM))
    if (quizM) metaM.push(`${quizM} quiz${quizM === 1 ? '' : 'zes'}`)

    const items = cm.map((c, k) => {
      const e = est(c)
      const bloqueada = !e?.desbloqueada
      const esSig = siguiente?.id === c.id
      const estado = bloqueada ? ' bloqueada' : e?.hecha ? ' hecha' : ''
      const icono = bloqueada ? '<i class="fa-solid fa-lock"></i>'
                  : e?.hecha ? '<i class="fa-solid fa-check"></i>'
                  : esSig ? '<i class="fa-solid fa-play"></i>' : ''
      const metaC = [`Clase ${k + 1}`]
      if (c.duracion_seg) metaC.push(`<i class="fa-regular fa-clock"></i> ${minutosDe(c.duracion_seg)} min`)
      if (e?.tiene_quiz) metaC.push(e.quiz_rendido && e.mejor_nota != null
        ? `<i class="fa-regular fa-circle-check"></i> Quiz ${esc(e.mejor_nota)}/20`
        : '<i class="fa-regular fa-circle-question"></i> Quiz')
      const inner = `
        <span class="tl-punto">${icono}</span>
        <span class="tl-txt">
          <span class="tl-tit">${esc(c.titulo)}</span>
          <span class="tl-meta">${metaC.join('<span class="tl-sep">·</span>')}${e?.actualizada ? '<span class="tl-chip">Actualizada</span>' : ''}</span>
        </span>`
      return bloqueada
        ? `<li><span class="tl-clase bloqueada" title="Se abre al completar la clase anterior (video y quiz)">${inner}</span></li>`
        : `<li><a class="tl-clase${estado}${esSig ? ' actual' : ''}" href="${enlaceClase(c)}">${inner}</a></li>`
    }).join('')

    return `
      <details class="det-mod${done ? ' hecho' : ''}${lock ? ' bloqueado' : ''}${actual ? ' actual' : ''}" ${actual ? 'open' : ''}>
        <summary>
          <span class="det-mod-num">${num}</span>
          <span class="det-mod-txt">
            <span class="det-mod-tit">${esc(m.titulo)}</span>
            <span class="det-mod-meta">${metaM.join(' · ')}</span>
          </span>
          <span class="det-mod-estado">
            <span class="cur-chip ${eCls}">${eTxt}</span>
            <span class="det-mod-bar${done ? ' lleno' : ''}"><span style="width:${pctM}%"></span></span>
          </span>
          <i class="fa-solid fa-chevron-down det-chev"></i>
        </summary>
        ${m.descripcion ? `<p class="det-mod-desc">${esc(m.descripcion)}</p>` : ''}
        ${cm.length ? `<ol class="tl-lista det-clases">${items}</ol>` : '<div class="det-vacio">Este módulo todavía no tiene clases.</div>'}
      </details>`
  }).join('')
}

const est = (clase) => (clase ? STATE.estados.get(clase.id) : null)
const ordenModulo = (a, b) => (a.orden ?? 0) - (b.orden ?? 0) || String(a.id).localeCompare(String(b.id))

async function initAula() {
  mostrarCarga('Cargando tu curso...')
  const sesion = await exigirAlumnoActivo()
  if (!sesion) return false
  const { usuario, perfil } = sesion

  document.getElementById('sb-nombre').textContent   = perfil.full_name || usuario.email
  document.getElementById('sb-perfil').textContent   = PERFIL_LABELS[perfil.perfil] || perfil.perfil || ''
  document.getElementById('sb-initials').textContent = initials(perfil.full_name)
  document.getElementById('btn-salir')?.addEventListener('click', async () => { await detenerSeguimiento(); await cerrarSesion() })

  document.getElementById('btn-volver')?.addEventListener('click', async (ev) => {
    ev.preventDefault()
    try { await detenerSeguimiento() } catch {   }
    const cid = STATE.cursoActual?.id || new URLSearchParams(location.search).get('curso')
    window.location.href = cid ? 'curso.html?curso=' + encodeURIComponent(cid) : 'catalogo.html'
  })

  const courseId = new URLSearchParams(location.search).get('curso') || sessionStorage.getItem('curso_id')
  if (!courseId) { window.location.href = 'catalogo.html'; return false }

  await finalizarMisQuizzesVencidos()

  const [curso, matricula, modulos, estados, progreso, resultado, trabajo] = await Promise.all([
    getCurso(courseId), getMatricula(usuario.id, courseId), getModulos(courseId),
    getMisClases(courseId), getProgreso(usuario.id, courseId), getMiResultado(courseId),
    getExamen(usuario.id, courseId),
  ])
  if (!curso || !matricula) {
    ocultarCarga()
    alert('No estás matriculado en este curso.')
    window.location.href = 'catalogo.html'; return false
  }
  sessionStorage.setItem('curso_id', courseId)
  sessionStorage.setItem('curso_titulo', curso.titulo)
  STATE.cursoActual = curso
  STATE.refrescar   = refrescarEstado
  document.getElementById('sb-curso').textContent = curso.titulo
  const verRes = document.getElementById('sb-ver-res')
  if (verRes) verRes.href = 'curso.html?curso=' + encodeURIComponent(courseId)
  document.title = `${curso.titulo} · PROMOVILIDAD`
  if (matricula.estado === 'matriculado') marcarEnProgreso(usuario.id, courseId)

  STATE.modulos   = [...modulos].sort(ordenModulo)
  STATE.estados   = new Map(estados.map(e => [e.class_id, e]))
  STATE.progreso  = progreso
  STATE.resultado = resultado
  STATE.trabajo   = trabajo

  const clases = await getClasesDelCurso(STATE.modulos.map(m => m.id))
  const pos = (c) => STATE.estados.get(c.id)?.posicion ?? 1e9
  STATE.todasClases = clases.sort((a, b) => pos(a) - pos(b))

  actualizarProgreso()
  renderResultado()
  renderTrabajo()
  ocultarCarga()

  if (STATE.modulos.length === 0 || STATE.todasClases.length === 0) {
    renderSidebar()
    if (STATE.modulos.length === 0) {
      document.getElementById('sb-nav').innerHTML = '<div style="padding:16px;font-size:12px;color:var(--muted)">Este curso todavía no tiene módulos.</div>'
    }
    document.getElementById('ph-txt').textContent = 'Este curso todavía no tiene clases publicadas.'
    actualizarBotonesClase()
    actualizarPestanas()
    return true
  }

  const abiertas = STATE.todasClases.filter(c => est(c)?.desbloqueada)
  const pedida   = new URLSearchParams(location.search).get('clase')
  const destino  = abiertas.find(c => c.id === pedida)
    || abiertas.find(c => !est(c).hecha) || abiertas[abiertas.length - 1] || STATE.todasClases[0]
  await abrirModulo(STATE.modulos.find(m => m.id === destino.module_id), destino)
  return true
}

async function refrescarEstado() {
  const cid = STATE.cursoActual?.id
  if (!cid) return
  const [estados, resultado, progreso] = await Promise.all([
    getMisClases(cid), getMiResultado(cid), getProgreso(STATE.usuario.id, cid),
  ])
  STATE.estados   = new Map(estados.map(e => [e.class_id, e]))
  STATE.resultado = resultado
  STATE.progreso  = progreso
  renderSidebar(); actualizarProgreso(); actualizarNavegacion()
  renderResultado(); renderTrabajo(); actualizarBotonesClase(); actualizarQuizStatus()
}

async function abrirModulo(modulo, clase = null) {
  if (!modulo) return
  STATE.moduloActual = modulo
  STATE.clases = STATE.todasClases.filter(c => c.module_id === modulo.id)
  document.getElementById('tb-title').textContent = `Módulo ${STATE.modulos.indexOf(modulo) + 1} · ${modulo.titulo}`
  const destino = clase
    || STATE.clases.find(c => est(c)?.desbloqueada && !est(c)?.hecha)
    || STATE.clases.filter(c => est(c)?.desbloqueada).pop()
    || null
  if (destino) await cargarClase(destino)
  else {
    STATE.claseActual = null
    renderSidebar()
    if (STATE.clases.length) toast('Este módulo se abre cuando completes las clases anteriores', 'wa', 4500)
  }
}

function parseVideo(clase) {
  return parseVideoUrl(clase.video_url || clase.youtube_id)
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

const clavePosicion = (classId) => `pmv_pos_${STATE.usuario?.id || 'x'}_${classId}`
function leerPosicion(classId) {
  try {
    const v = Number(localStorage.getItem(clavePosicion(classId)))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch { return null }
}
function guardarPosicion() {
  const seg = STATE.seguimiento
  if (!seg || !STATE.player?.getCurrentTime) return
  try {
    const t = Math.floor(STATE.player.getCurrentTime() || 0)
    const dur = Math.floor(STATE.player.getDuration?.() || 0)
    if (dur && t >= dur - 10) localStorage.removeItem(clavePosicion(seg.classId))
    else if (t > 0) localStorage.setItem(clavePosicion(seg.classId), String(t))
  } catch {   }
}

async function guardarAvance() {
  const seg = STATE.seguimiento
  if (!seg || seg.completada || seg.enviando || seg.segundos === seg.guardado) return false
  seg.enviando = true
  seg.guardado = seg.segundos
  const { data } = await registrarAvance(seg.classId, seg.segundos)
  seg.enviando = false
  if (data?.completada && !seg.completada) { seg.completada = true; return true }
  return false
}

async function detenerSeguimiento() {
  guardarPosicion()
  clearInterval(STATE.videoInterval)
  STATE.videoInterval = null
  await guardarAvance()
  STATE.seguimiento = null
  if (STATE.player) {
    try { STATE.player.destroy() } catch {   }
    STATE.player = null
  }
}

async function cargarClase(clase) {
  if (!est(clase)?.desbloqueada) {
    toast('Esta clase se abre cuando completes la anterior (video y quiz)', 'wa', 4500)
    return
  }
  const miCarga = ++STATE.cargaId
  await detenerSeguimiento()
  STATE.claseActual = clase

  const min = Math.round((clase.duracion_seg || 0) / 60)
  document.getElementById('tb-sub').textContent = clase.titulo + (min ? ` · ${min} min` : '')

  const wrap       = document.getElementById('v-wrap')
  const ph         = document.getElementById('v-ph')
  const panelDesc  = document.getElementById('panel-descripcion')
  const panelTexto = document.getElementById('panel-texto-video')
  const extLink    = document.getElementById('yt-link')
  const descCard   = document.getElementById('clase-desc')
  wrap.querySelectorAll('iframe, #yt-player').forEach(el => el.remove())
  if (panelTexto) panelTexto.style.display = 'none'

  renderSidebar()
  actualizarNavegacion()
  mostrarRecursos(clase)
  mostrarMisConsultas(clase)
  actualizarBotonesClase()
  actualizarQuizStatus()

  const previo = STATE.progreso.find(p => p.class_id === clase.id)
  registrarAvance(clase.id, previo?.segundos_vistos || 0).then(() => {
    const e = est(clase)
    if (e?.actualizada) { e.actualizada = false; renderSidebar() }
  })

  const video = parseVideo(clase)

  if (descCard) {
    descCard.hidden = !(video && clase.descripcion)
    if (video && clase.descripcion) descCard.innerHTML = `<strong>Sobre esta clase</strong>${esc(clase.descripcion)}`
  }
  actualizarPestanas()

  if (!video) {
    ph.style.display = 'none'
    wrap.style.display = 'none'
    if (extLink) extLink.style.display = 'none'
    if (panelDesc) {
      panelDesc.style.display = 'block'
      document.getElementById('desc-titulo').textContent = clase.titulo
      document.getElementById('desc-texto').textContent =
        clase.descripcion || STATE.moduloActual?.descripcion || 'Revisa los materiales de esta clase y luego pulsa "Completar clase".'
    }
    return
  }

  if (panelDesc) panelDesc.style.display = 'none'
  wrap.style.display = ''
  ph.style.display = 'none'

  if (video.tipo === 'drive') {
    const iframe = document.createElement('iframe')
    iframe.src = `https://drive.google.com/file/d/${encodeURIComponent(video.id)}/preview`
    iframe.allow = 'autoplay; encrypted-media'
    iframe.allowFullscreen = true
    wrap.appendChild(iframe)
    if (extLink) {
      extLink.style.display = ''
      extLink.href = `https://drive.google.com/file/d/${encodeURIComponent(video.id)}/view`
      extLink.innerHTML = '<i class="fa-brands fa-google-drive" style="color:#1fa463"></i> Abrir en Drive'
    }
    return
  }

  if (extLink) {
    extLink.style.display = ''
    extLink.href = `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`
    extLink.innerHTML = '<i class="fa-brands fa-youtube" style="color:#ff0000"></i> YouTube'
  }

  const div = document.createElement('div')
  div.id = 'yt-player'
  wrap.appendChild(div)

  const YT = await cargarYouTubeAPI()
  if (miCarga !== STATE.cargaId) return

  STATE.seguimiento = {
    classId:    clase.id,
    segundos:   previo?.segundos_vistos || 0,
    guardado:   previo?.segundos_vistos || 0,
    completada: !!est(clase)?.completada,
    enviando:   false,
  }

  const visto  = previo?.segundos_vistos || 0
  const exacta = leerPosicion(clase.id)
  const base   = exacta ?? (est(clase)?.completada ? 0 : visto)
  const inicio = base > 10 && (!clase.duracion_seg || base < clase.duracion_seg - 10)
    ? Math.max(0, Math.floor(base) - 3) : 0
  STATE.player = new YT.Player('yt-player', {
    videoId: video.id,
    playerVars: { rel: 0, modestbranding: 1, playsinline: 1, start: inicio },
  })
  if (inicio) toast(`Al darle play, sigues desde el minuto ${Math.floor(inicio / 60)}:${String(inicio % 60).padStart(2, '0')}`, '', 5000)

  const duracion = clase.duracion_seg || 0
  STATE.videoInterval = setInterval(async () => {
    const seg = STATE.seguimiento
    if (!seg || seg.completada || !STATE.player?.getPlayerState) return
    if (STATE.player.getPlayerState() !== YT.PlayerState.PLAYING) return

    seg.segundos++
    if (seg.segundos % 5 === 0) guardarPosicion()
    const llego = duracion > 0 && seg.segundos >= duracion * UMBRAL_COMPLETADO
    if (llego || seg.segundos - seg.guardado >= GUARDAR_CADA_SEG) {
      const completo = await guardarAvance()
      if (completo) {
        toast('Clase completada.' + (est(clase)?.tiene_quiz ? ' Ya puedes rendir el quiz.' : ''), 'ok', 4500)
        await refrescarEstado()
      }
    }
  }, 1000)
}

function mostrarRecursos(clase) {
  const card  = document.getElementById('card-recursos')
  const lista = document.getElementById('lista-recursos')
  if (!card || !lista) return
  let recursos = []
  try {
    if (clase.recursos && clase.recursos !== '[]') {
      recursos = typeof clase.recursos === 'string' ? JSON.parse(clase.recursos) : clase.recursos
    }
  } catch { recursos = [] }
  if (!Array.isArray(recursos) || recursos.length === 0) { card.style.display = 'none'; return }

  const iconos = {
    pdf:   ['fa-solid fa-file-pdf',        '#dc2626'],
    docx:  ['fa-solid fa-file-word',       '#2563eb'],
    xlsx:  ['fa-solid fa-file-excel',      '#16a34a'],
    pptx:  ['fa-solid fa-file-powerpoint', '#d97706'],
    drive: ['fa-brands fa-google-drive',   '#1fa463'],
    link:  ['fa-solid fa-link',            'var(--blue)'],
  }
  card.style.display = 'block'
  lista.innerHTML = recursos.map(r => {
    const url  = urlSegura(r.url || '#')
    const tipo = r.tipo || (/(drive|docs)\.google\.com/.test(url) ? 'drive' : 'link')
    const [icono, color] = iconos[tipo] || ['fa-solid fa-file', 'var(--muted)']
    return `<a class="recurso" href="${esc(url)}" target="_blank" rel="noopener">
      <i class="${icono}" style="color:${color}"></i>
      <span>${esc(r.nombre || 'Abrir archivo')}</span>
      <i class="fa-solid fa-arrow-up-right-from-square recurso-ext"></i>
    </a>`
  }).join('')
}

async function mostrarMisConsultas(clase) {
  const el = document.getElementById('mis-consultas')
  if (!el || !clase) return
  const lista = await getConsultas(STATE.usuario.id, clase.id)
  if (STATE.claseActual?.id !== clase.id) return
  const nCons = document.getElementById('n-cons')
  if (nCons) nCons.textContent = lista.length || ''
  if (!lista.length) { el.innerHTML = ''; return }
  el.innerHTML = `<div class="mc-titulo">Tus consultas en esta clase</div>` + lista.map(c => `
    <div class="mc-item">
      <div class="mc-preg">${esc(c.pregunta)}</div>
      ${c.respondida
        ? `<div class="mc-resp"><strong><i class="fa-solid fa-reply"></i> Respuesta de la profesora</strong>${esc(c.respuesta)}</div>`
        : '<div class="mc-espera"><i class="fa-regular fa-clock"></i> Esperando respuesta</div>'}
      <div class="mc-fecha">${formatFecha(c.created_at)}</div>
    </div>`).join('')
}

function renderSidebar() {
  const nav = document.getElementById('sb-nav')
  if (!nav) return

  nav.innerHTML = STATE.modulos.map((m, i) => {
    const clasesMod = STATE.todasClases.filter(c => c.module_id === m.id)
    const hechas    = clasesMod.filter(c => est(c)?.hecha).length
    const isOpen    = STATE.moduloActual?.id === m.id
    const modDone   = clasesMod.length > 0 && hechas === clasesMod.length
    const modLock   = clasesMod.length > 0 && clasesMod.every(c => !est(c)?.desbloqueada)
    const pct       = clasesMod.length ? Math.round(hechas / clasesMod.length * 100) : 0
    const num = modDone ? '<i class="fa-solid fa-check"></i>'
              : modLock ? '<i class="fa-solid fa-lock"></i>'
              : (i + 1)

    const lista = isOpen ? clasesMod.map((c, k) => {
      const e      = est(c)
      const lock   = !e?.desbloqueada
      const active = STATE.claseActual?.id === c.id
      const estado = lock ? ' bloqueada' : e?.hecha ? ' hecha' : ''
      const icono  = lock ? '<i class="fa-solid fa-lock"></i>'
                   : e?.hecha ? '<i class="fa-solid fa-check"></i>'
                   : active ? '<i class="fa-solid fa-play"></i>'
                   : ''
      const min    = c.duracion_seg ? Math.max(1, Math.round(c.duracion_seg / 60)) : 0
      const meta   = [`Clase ${k + 1}`]
      if (min) meta.push(`<i class="fa-regular fa-clock"></i> ${min} min`)
      if (e?.tiene_quiz) meta.push('<i class="fa-regular fa-circle-question"></i> Quiz')
      const titulo = lock ? 'Se abre al completar la clase anterior (video y quiz)' : ''
      return `<li><button class="tl-clase${estado}${active ? ' actual' : ''}"
                data-clase="${esc(c.id)}" title="${titulo}" ${lock ? 'aria-disabled="true"' : ''} ${active ? 'aria-current="true"' : ''}>
        <span class="tl-punto">${icono}</span>
        <span class="tl-txt">
          <span class="tl-tit">${esc(c.titulo)}</span>
          <span class="tl-meta">${meta.join('<span class="tl-sep">·</span>')}${e?.actualizada ? '<span class="tl-chip" title="La profesora actualizó esta clase">Actualizada</span>' : ''}</span>
        </span>
      </button></li>`
    }).join('') : ''

    return `<section class="tl-mod${isOpen ? ' abierto' : ''}${modDone ? ' hecho' : ''}${modLock ? ' bloqueado' : ''}">
      <button class="tl-mod-btn" data-modulo="${esc(m.id)}" aria-expanded="${isOpen}">
        <span class="tl-mod-num">${num}</span>
        <span class="tl-mod-txt">
          <span class="tl-mod-tit">${esc(m.titulo)}</span>
          <span class="tl-mod-sub">${hechas} de ${clasesMod.length} clase${clasesMod.length === 1 ? '' : 's'}</span>
        </span>
        <i class="fa-solid fa-chevron-down tl-chev"></i>
      </button>
      <div class="tl-barra"><span style="width:${pct}%"></span></div>
      ${isOpen ? `<ol class="tl-lista">${lista}</ol>` : ''}
    </section>`
  }).join('')
}

function actualizarNavegacion() {
  const idx  = STATE.todasClases.findIndex(c => c.id === STATE.claseActual?.id)
  const sig  = STATE.todasClases[idx + 1]
  const prev = document.getElementById('btn-prev')
  const next = document.getElementById('btn-next')
  if (prev) prev.disabled = idx <= 0
  if (next) {
    next.disabled = idx < 0 || !sig
    next.title = sig && !est(sig)?.desbloqueada ? 'Completa esta clase (y su quiz) para continuar' : ''
  }
}

async function moverClase(delta) {
  const idx = STATE.todasClases.findIndex(c => c.id === STATE.claseActual?.id)
  const destino = STATE.todasClases[idx + delta]
  if (!destino) return
  if (!est(destino)?.desbloqueada) {
    toast('Primero completa esta clase' + (est(STATE.claseActual)?.tiene_quiz ? ' y rinde su quiz' : '') + '', 'wa', 4500)
    return
  }
  if (destino.module_id !== STATE.moduloActual?.id) {
    await abrirModulo(STATE.modulos.find(m => m.id === destino.module_id), destino)
  } else {
    await cargarClase(destino)
  }
}

function actualizarProgreso() {
  const r     = STATE.resultado
  const total = r?.total_clases ?? STATE.todasClases.length
  const done  = r?.clases_completadas ?? 0
  const pct   = total > 0 ? Math.round(done / total * 100) : 0
  const fill  = document.getElementById('prog-fill')
  const label = document.getElementById('prog-label')
  if (fill)  fill.style.width  = pct + '%'
  if (label) label.textContent = `${done} de ${total} clase${total === 1 ? '' : 's'}`
  const pctEl = document.getElementById('prog-pct')
  if (pctEl) pctEl.textContent = `${pct} %`
}

function actualizarBotonesClase() {
  const btn = document.getElementById('btn-completar')
  if (!btn) return
  const c = STATE.claseActual
  const e = est(c)
  const video  = c ? parseVideo(c) : null
  const manual = !!c && (!video || video.tipo === 'drive' || !c.duracion_seg)
  btn.hidden = !c || !manual || !!e?.completada
}

function actualizarQuizStatus() {
  const c = STATE.claseActual
  const e = est(c)
  const wrap    = document.querySelector('.qs-wrap')
  const scoreEl = document.getElementById('qs-score')
  const labelEl = document.getElementById('qs-label')
  const fillEl  = document.getElementById('qs-fill')
  const btnTop  = document.getElementById('btn-quiz')
  const btn2    = document.getElementById('btn-quiz2')
  if (!scoreEl) return

  const tiene = !!e?.tiene_quiz
  if (wrap)   wrap.hidden   = !tiene
  if (btnTop) btnTop.hidden = !tiene
  if (!tiene) return

  const puede = e.completada && !e.quiz_rendido
  ;[btnTop, btn2].filter(Boolean).forEach(b => { b.disabled = !puede })
  if (e.quiz_rendido) {
    scoreEl.textContent = e.mejor_nota + '/20'
    labelEl.textContent = (e.mejor_nota >= NOTA_MINIMA ? 'Aprobado' : 'Debajo de 12') + ' · quiz ya rendido'
    fillEl.style.width  = (e.mejor_nota / 20 * 100) + '%'
    if (btn2) btn2.textContent = 'Quiz ya rendido'
  } else if (!e.completada) {
    scoreEl.textContent = '—'
    labelEl.textContent = 'Primero termina la clase (video o lectura)'
    fillEl.style.width  = '0%'
    if (btn2) btn2.textContent = 'Iniciar quiz'
  } else {
    scoreEl.textContent = '—'
    labelEl.textContent = `Listo para rendir · 1 solo intento · mínimo ${NOTA_MINIMA}/20`
    fillEl.style.width  = '0%'
    if (btn2) btn2.textContent = 'Iniciar quiz'
  }
  actualizarPestanas()
}

function actualizarPestanas() {
  const tabs = document.querySelector('.aula-tabs')
  if (!tabs) return
  const $ = (id) => document.getElementById(id)
  const e = est(STATE.claseActual)

  const hayDesc = !$('clase-desc')?.hidden
  const nMat    = $('lista-recursos')?.children.length || 0
  const hayMat  = $('card-recursos')?.style.display !== 'none' && nMat > 0
  const hayQuiz = !!e?.tiene_quiz

  $('t-desc').hidden = !hayDesc
  $('t-mat').hidden  = !hayMat
  $('t-quiz').hidden = !hayQuiz
  $('n-mat').textContent = hayMat ? nMat : ''
  $('mat-vacio').hidden  = hayMat

  $('p-quiz').hidden = !(hayQuiz && e?.completada && !e?.quiz_rendido)

  const visibles = [...tabs.querySelectorAll('.aula-tab')].filter(t => !t.hidden).map(t => t.dataset.tab)
  const elegida  = visibles.includes(STATE.tabAula) ? STATE.tabAula : visibles[0]
  mostrarPestana(elegida, false)
}

function mostrarPestana(tab, recordar = true) {
  if (!tab) return
  if (recordar) STATE.tabAula = tab
  document.querySelectorAll('.aula-tab').forEach(t => {
    const activa = t.dataset.tab === tab
    t.classList.toggle('activa', activa)
    t.setAttribute('aria-selected', activa)
  })
  document.querySelectorAll('.aula-panel').forEach(pnl => { pnl.hidden = pnl.id !== 'tab-' + tab })
}

function renderAvisoCurso() {
  const el = document.getElementById('aviso-curso')
  const r  = STATE.resultado
  if (!el) return
  const enlace = `curso.html?curso=${encodeURIComponent(STATE.cursoActual?.id || '')}`
  const avisos = {
    aprobado:    ['ok',   'fa-solid fa-award', '¡Aprobaste el curso! Revisa tu resultado en el detalle del curso.', 'Ver mi resultado'],
    desaprobado: ['mal',  'fa-solid fa-circle-exclamation', `Tu promedio quedó por debajo de ${NOTA_MINIMA}. Desde el detalle del curso puedes volver a darlo.`, 'Ver opciones'],
    falta_trabajo: r?.trabajo_estado === 'pendiente'
      ? ['info', 'fa-solid fa-hourglass-half', 'Tu trabajo final está en revisión. Te avisaremos el resultado en el detalle del curso.', 'Ver estado']
      : ['aviso', 'fa-solid fa-file-circle-check', r?.trabajo_estado === 'desaprobado'
          ? 'La profesora observó tu trabajo final. Revisa el comentario y envía el enlace corregido.'
          : 'Terminaste las clases y quizzes. Envía tu trabajo final desde el detalle del curso.', 'Ir al trabajo final'],
  }
  const a = r && avisos[r.estado]
  el.hidden = !a
  if (!a) return
  el.className = `aviso-curso av-${a[0]}`
  el.innerHTML = `<i class="${a[1]}"></i><span>${esc(a[2])}</span><a class="btn btn-sm" href="${enlace}">${esc(a[3])}</a>`
}

function renderResultado() {
  renderAvisoCurso()
  const r = STATE.resultado
  const $ = (id) => document.getElementById(id)
  if (!r || !$('res-estado')) return

  const tEstado = r.trabajo_estado
  const faltaTrabajo = tEstado === 'pendiente' ? 'Trabajo en revisión'
                     : tEstado === 'desaprobado' ? 'Trabajo observado'
                     : 'Falta trabajo final'
  const etiquetas = {
    en_curso: 'En curso', aprobado: 'Aprobado', desaprobado: 'Desaprobado', falta_trabajo: faltaTrabajo,
  }
  $('res-estado').className   = 'res-estado re-' + r.estado + (r.estado === 'falta_trabajo' && tEstado === 'pendiente' ? ' re-trab-revision' : '')
  $('res-estado').textContent = etiquetas[r.estado] || r.estado
  $('res-clases').textContent  = `${r.clases_completadas} / ${r.total_clases}`
  $('res-quizzes').textContent = r.total_quizzes ? `${r.quizzes_rendidos} / ${r.total_quizzes}` : 'Sin quizzes'
  $('res-promedio').textContent = r.total_quizzes ? `${r.promedio ?? 0} / 20` : '—'
  $('res-intento-row').hidden = !(r.intento > 1)
  $('res-intento').textContent = r.intento

  const mensajes = {
    en_curso: r.total_quizzes
      ? `Necesitas ${NOTA_MINIMA} de promedio. Los quizzes que no rindas cuentan como 0.`
      : 'Completa todas las clases para terminar el curso.',
    desaprobado: `Tu promedio quedó por debajo de ${NOTA_MINIMA}. Puedes volver a dar el curso: se reinicia tu avance y tus quizzes.`,
    falta_trabajo: tEstado === 'pendiente'
      ? 'Aprobaste los quizzes y ya enviaste tu trabajo final. La profesora lo está revisando.'
      : tEstado === 'desaprobado'
        ? 'Aprobaste los quizzes. La profesora observó tu trabajo final: revisa el comentario y envía el enlace corregido.'
        : 'Aprobaste los quizzes. Solo te falta enviar tu trabajo final.',
    aprobado: '¡Felicitaciones! Aprobaste el curso. El equipo PROMOVILIDAD emitirá tu constancia.',
  }
  $('res-msg').textContent = mensajes[r.estado] || ''
  $('btn-reiniciar').hidden = r.estado !== 'desaprobado'
}

function renderTrabajo() {
  const card = document.getElementById('card-trabajo')
  if (!card) return
  card.hidden = !STATE.cursoActual?.requiere_trabajo
  if (card.hidden) return

  const t = STATE.trabajo
  const form = document.getElementById('trab-form')
  const info = document.getElementById('trab-estado')
  const btn  = document.getElementById('btn-trabajo')
  const enlace = t?.enlace_url
    ? `<a href="${esc(urlSegura(t.enlace_url))}" target="_blank" rel="noopener">ver enlace</a>`
    : (t?.archivo_nombre ? esc(t.archivo_nombre) : '')

  const r = STATE.resultado
  const terminado = !!r && r.total_clases > 0
    && r.clases_completadas >= r.total_clases
    && r.quizzes_rendidos >= r.total_quizzes

  if (!t && !terminado) {
    form.hidden = true
    const faltan = [
      r ? `${r.clases_completadas}/${r.total_clases} clases` : '',
      r?.total_quizzes ? `${r.quizzes_rendidos}/${r.total_quizzes} quizzes` : '',
    ].filter(Boolean).join(' · ')
    info.innerHTML = `<i class="fa-solid fa-lock" style="color:var(--muted)"></i>
      Se habilita cuando completes todas las clases y quizzes del curso.
      ${faltan ? `<br><strong>Llevas: ${faltan}</strong>` : ''}`
  } else if (!t) {
    form.hidden = false
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar trabajo'
    info.innerHTML = '<span style="color:#1a7a35"><i class="fa-solid fa-circle-check"></i> Terminaste el curso: ya puedes enviar tu trabajo final.</span>'
  } else if (t.estado === 'revisado' || t.estado === 'aprobado') {
    form.hidden = true
    info.innerHTML = `<span style="color:#1a7a35;font-weight:600"><i class="fa-solid fa-circle-check"></i> Conforme</span>
      · entregado el ${formatFecha(t.created_at)} (${enlace})
      ${t.comentario ? `<br><em>"${esc(t.comentario)}"</em>` : ''}`
  } else if (t.estado === 'desaprobado') {
    form.hidden = false
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar trabajo corregido'
    info.innerHTML = `<span style="color:var(--amber);font-weight:600"><i class="fa-solid fa-triangle-exclamation"></i> Observado</span>
      ${t.comentario ? `: <em>"${esc(t.comentario)}"</em>` : ''}<br>Corrige tu trabajo y envía el nuevo enlace.`
  } else {
    form.hidden = false
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Reemplazar enlace'
    info.innerHTML = `<i class="fa-solid fa-hourglass-half" style="color:var(--blue)"></i>
      Enviado el ${formatFecha(t.created_at)} (${enlace}) · <strong>en revisión</strong>.
      La profesora lo revisará y lo marcará como conforme u observado.`
  }
}

function initAccionesCurso() {

  document.getElementById('btn-trabajo')?.addEventListener('click', async (e) => {
    const inp = document.getElementById('trab-enlace')
    const enlace = inp?.value.trim()
    if (!enlace) { toast('Pega el enlace de tu trabajo en Google Drive', 'wa'); return }
    if (!/^https:\/\/(drive|docs)\.google\.com\//i.test(enlace)) {
      toast('El enlace debe ser de Google Drive (empieza con https://drive.google.com o https://docs.google.com)', 'wa', 6000); return
    }
    if (STATE.trabajo && !confirm('Ya enviaste un trabajo. ¿Quieres reemplazarlo por este nuevo enlace?')) return
    const restaurar = cargando(e.currentTarget, 'Enviando...')
    const { error } = await entregarTrabajo(STATE.usuario.id, STATE.cursoActual.id, enlace)
    restaurar()
    if (error) { toast('No se pudo enviar: ' + error.message, 'wa', 6000); return }
    inp.value = ''
    toast('Trabajo enviado. La profesora lo revisará.', 'ok', 5000)
    STATE.trabajo = await getExamen(STATE.usuario.id, STATE.cursoActual.id)
    await STATE.refrescar?.()
  })

  document.getElementById('btn-reiniciar')?.addEventListener('click', async (e) => {
    if (!confirm('¿Volver a dar el curso?\n\nSe guardará un resumen de este intento y se reiniciará tu avance: tendrás que ver las clases y rendir los quizzes de nuevo.')) return
    const restaurar = cargando(e.currentTarget, 'Reiniciando...')
    const { data, error } = await reiniciarCurso(STATE.cursoActual.id)
    restaurar()
    if (error) { toast('No se pudo reiniciar: ' + error.message, 'wa', 6000); return }
    toast(`Empiezas el intento ${data?.intento || 2}. ¡Ánimo!`, 'ok', 4000)
    setTimeout(() => location.reload(), 1200)
  })
}

function initBotonesAula() {

  document.getElementById('sb-nav')?.addEventListener('click', async (e) => {
    const mod = e.target.closest('[data-modulo]')
    const cls = e.target.closest('[data-clase]')
    if (cls) {
      const c = STATE.clases.find(c => c.id === cls.dataset.clase)
      if (c) await cargarClase(c)
    } else if (mod) {
      const m = STATE.modulos.find(m => m.id === mod.dataset.modulo)
      if (m && m.id !== STATE.moduloActual?.id) await abrirModulo(m)
    }
    document.body.classList.remove('sb-abierto')
  })

  document.querySelector('.aula-tabs')?.addEventListener('click', (e) => {
    const t = e.target.closest('.aula-tab')
    if (t) mostrarPestana(t.dataset.tab)
  })

  document.getElementById('btn-menu')?.addEventListener('click', () => {
    document.body.classList.toggle('sb-abierto')
  })

  document.getElementById('btn-prev')?.addEventListener('click', () => moverClase(-1))
  document.getElementById('btn-next')?.addEventListener('click', () => moverClase(1))

  document.getElementById('btn-completar')?.addEventListener('click', async (e) => {
    const c = STATE.claseActual
    if (!c) { toast('Selecciona una clase primero'); return }
    const restaurar = cargando(e.currentTarget, 'Guardando...')
    const { data, error } = await registrarAvance(c.id, STATE.seguimiento?.segundos || 0, true)
    restaurar()
    if (error) { toast('No se pudo completar: ' + error.message, 'wa', 6000); return }
    if (!data?.completada) { toast('Termina de ver el video para completar la clase.', 'wa'); return }
    if (STATE.seguimiento) STATE.seguimiento.completada = true
    toast('Clase completada.' + (est(c)?.tiene_quiz ? ' Ya puedes rendir el quiz.' : ''), 'ok', 4500)
    await refrescarEstado()
  })

  const irQuiz = async () => {
    const c = STATE.claseActual
    const e = est(c)
    if (!c) { toast('Selecciona una clase primero'); return }
    if (e?.quiz_rendido) { toast('Ya rendiste este quiz. Solo se permite un intento.', 'wa'); return }
    if (!e?.completada)  { toast('Primero termina la clase (video o lectura) para rendir el quiz.', 'wa'); return }
    await detenerSeguimiento()
    sessionStorage.setItem('quiz_class_id',     c.id)
    sessionStorage.setItem('quiz_class_titulo', c.titulo)
    window.location.href = 'quiz.html'
  }
  document.getElementById('btn-quiz')?.addEventListener('click',  irQuiz)
  document.getElementById('btn-quiz2')?.addEventListener('click', irQuiz)

  initAccionesCurso()

  document.getElementById('btn-consulta')?.addEventListener('click', async (e) => {
    const ta  = document.getElementById('ask-ta')
    const txt = ta?.value.trim()
    if (!txt) { toast('Escribe tu consulta primero'); return }
    if (!STATE.claseActual) { toast('Selecciona una clase primero'); return }
    const restaurar = cargando(e.currentTarget, 'Enviando...')
    const { error } = await enviarConsulta(STATE.usuario.id, STATE.claseActual.id, txt)
    restaurar()
    if (error) { toast('Error al enviar la consulta', 'wa'); return }
    ta.value = ''
    toast('Consulta enviada al profesor', 'ok')
    mostrarMisConsultas(STATE.claseActual)
  })

  window.addEventListener('pagehide', () => { guardarPosicion(); guardarAvance() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { guardarPosicion(); guardarAvance() }
  })
}

async function initQuiz() {
  const usuario = await getUsuario()
  if (!usuario) { window.location.href = 'index.html'; return }
  STATE.usuario = usuario
  const classId = sessionStorage.getItem('quiz_class_id')
  const titulo  = sessionStorage.getItem('quiz_class_titulo') || 'esta clase'
  if (!classId) { window.location.href = 'aula.html'; return }
  document.getElementById('qz-titulo').textContent = 'Quiz · ' + titulo

  STATE.quizPreguntas = await getQuizPreguntas(classId)
  if (STATE.quizPreguntas.length === 0) {
    ocultarCarga()
    alert('Esta clase no tiene quiz asignado todavía.')
    window.location.href = 'aula.html'; return
  }

  const { data: ini, error } = await iniciarQuiz(classId)
  if (error || !ini) {
    ocultarCarga()
    alert(error?.message || 'No se pudo abrir el quiz.')
    window.location.href = 'aula.html'; return
  }
  if (ini.estado === 'rendido') {
    ocultarCarga()
    alert(`Ya rendiste este quiz (nota ${ini.nota}/20). Solo se permite un intento.`)
    window.location.href = 'aula.html'; return
  }
  if (ini.estado === 'vencido') {
    ocultarCarga()
    alert(`Se acabó el tiempo de este quiz. Se calificó con las respuestas que alcanzaste a marcar: ${ini.nota}/20.`)
    window.location.href = 'aula.html'; return
  }

  const guardadas = Array.isArray(ini.respuestas) ? ini.respuestas : []
  STATE.quizRespuestas = STATE.quizPreguntas.map((_, i) => Number.isInteger(guardadas[i]) ? guardadas[i] : undefined)
  const primeraLibre = STATE.quizRespuestas.findIndex(r => r === undefined)
  STATE.quizPreguntaActual = primeraLibre >= 0 ? primeraLibre : STATE.quizPreguntas.length - 1
  STATE.quizOpcionSeleccionada = null
  STATE.quizTerminado = false
  STATE.timerSegundos = Math.max(1, ini.segundos_restantes || 600)
  document.getElementById('timer').classList.remove('red')
  if (primeraLibre > 0) toast(`Continúas tu quiz desde la pregunta ${primeraLibre + 1}`, '', 4000)

  const pintarTiempo = () => {
    const m = String(Math.floor(STATE.timerSegundos / 60)).padStart(2, '0')
    const s = String(STATE.timerSegundos % 60).padStart(2, '0')
    document.getElementById('timer-txt').textContent = m + ':' + s
    if (STATE.timerSegundos <= 60) document.getElementById('timer').classList.add('red')
  }
  pintarTiempo()
  STATE.timerInterval = setInterval(() => {
    STATE.timerSegundos--
    pintarTiempo()
    if (STATE.timerSegundos <= 0) terminarQuiz()
  }, 1000)

  renderPregunta()
  ocultarCarga()
  document.getElementById('btn-nq')?.addEventListener('click', siguientePregunta)

  document.getElementById('btn-cancelar')?.addEventListener('click', () => {
    const faltan = STATE.quizRespuestas.filter(r => r === undefined).length
    if (!confirm(`¿Entregar el quiz ahora?${faltan ? `

Te faltan ${faltan} pregunta(s): contarán como incorrectas.` : ''}

Solo hay un intento.`)) return
    terminarQuiz()
  })

  window.addEventListener('beforeunload', (e) => {
    if (!STATE.quizTerminado) { e.preventDefault(); e.returnValue = '' }
  })

  document.addEventListener('keydown', (e) => {
    const k = e.key.toUpperCase()
    const i = KEYS.indexOf(k) >= 0 ? KEYS.indexOf(k) : ['1', '2', '3', '4'].indexOf(k)
    const opciones = STATE.quizPreguntas[STATE.quizPreguntaActual]?.opciones || []
    if (i >= 0 && i < opciones.length) elegirOpcion(i)
    if (e.key === 'Enter' && !document.getElementById('btn-nq').disabled) { e.preventDefault(); siguientePregunta() }
  })
}

const KEYS = ['A', 'B', 'C', 'D', 'E', 'F']

function renderPregunta() {
  const q = STATE.quizPreguntas[STATE.quizPreguntaActual]
  const t = STATE.quizPreguntas.length
  document.getElementById('q-tag').textContent  = `Pregunta ${STATE.quizPreguntaActual + 1} de ${t}`
  document.querySelector('.q-pts').textContent  = `${Math.round(20 / t * 10) / 10} puntos`
  document.getElementById('qz-fill').style.width = (STATE.quizPreguntaActual / t * 100) + '%'
  document.getElementById('q-text').textContent  = q.pregunta
  document.getElementById('qz-hint').textContent = 'Selecciona una respuesta'
  document.getElementById('btn-nq').disabled     = true
  document.getElementById('btn-nq').innerHTML    = STATE.quizPreguntaActual === t - 1
    ? 'Terminar <i class="fa-solid fa-flag-checkered"></i>'
    : 'Siguiente <i class="fa-solid fa-chevron-right"></i>'
  STATE.quizOpcionSeleccionada = null

  const cont = document.getElementById('q-opts')
  cont.innerHTML = (q.opciones || []).map((o, i) =>
    `<button class="opt" data-idx="${i}"><span class="ok-key">${KEYS[i]}</span><span>${esc(o)}</span></button>`
  ).join('')
  cont.querySelectorAll('.opt').forEach(el => {
    el.addEventListener('click', () => elegirOpcion(parseInt(el.dataset.idx)))
  })
}

function elegirOpcion(i) {
  if (STATE.quizTerminado || STATE.quizAvanzando) return
  STATE.quizOpcionSeleccionada = i
  document.querySelectorAll('.opt').forEach((el, j) => el.classList.toggle('sel', j === i))
  document.getElementById('btn-nq').disabled     = false
  document.getElementById('qz-hint').textContent = 'Respuesta seleccionada'
}

function siguientePregunta() {
  if (STATE.quizOpcionSeleccionada === null || STATE.quizTerminado || STATE.quizAvanzando) return
  STATE.quizAvanzando = true
  STATE.quizRespuestas[STATE.quizPreguntaActual] = STATE.quizOpcionSeleccionada

  guardarRespuestasQuiz(sessionStorage.getItem('quiz_class_id'),
    STATE.quizPreguntas.map((_, i) => Number.isInteger(STATE.quizRespuestas[i]) ? STATE.quizRespuestas[i] : null))
  document.getElementById('btn-nq').disabled = true
  setTimeout(() => {
    STATE.quizAvanzando = false
    STATE.quizPreguntaActual++
    if (STATE.quizPreguntaActual < STATE.quizPreguntas.length) renderPregunta()
    else terminarQuiz()
  }, 200)
}

async function terminarQuiz() {
  if (STATE.quizTerminado) return
  STATE.quizTerminado = true
  clearInterval(STATE.timerInterval)
  const btn = document.getElementById('btn-nq')
  btn.disabled = true
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Calificando...'
  document.getElementById('qz-hint').textContent = 'Enviando tus respuestas...'

  const respuestas = STATE.quizPreguntas.map((_, i) =>
    Number.isInteger(STATE.quizRespuestas[i]) ? STATE.quizRespuestas[i] : null)

  const classId = sessionStorage.getItem('quiz_class_id')
  const { data, error } = await calificarQuiz(classId, respuestas)
  if (error) {
    alert('No se pudo guardar tu quiz: ' + error.message + '\nIntenta nuevamente.')
    window.location.href = 'aula.html'
    return
  }

  sessionStorage.setItem('quiz_resultado', JSON.stringify({
    ...data,
    preguntas: STATE.quizPreguntas.map(q => q.pregunta),
  }))
  window.location.href = 'resultado.html'
}

function initResultado() {
  let r = null
  try { r = JSON.parse(sessionStorage.getItem('quiz_resultado') || 'null') } catch { r = null }
  if (!r) { window.location.href = 'aula.html'; return }

  const { nota = 0, correctas = 0, total = 0, mejor_nota, aciertos = [], preguntas = [] } = r
  const pass = nota >= NOTA_MINIMA
  document.getElementById('res-icon').className    = 'res-icon ' + (pass ? 'pass' : 'fail')
  document.getElementById('res-icon').innerHTML    = pass ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-rotate-left"></i>'
  document.getElementById('res-score').textContent = nota
  document.getElementById('res-score').className   = 'res-score ' + (pass ? 'pass' : 'fail')
  document.getElementById('res-title').textContent = pass ? 'Quiz aprobado' : 'Debajo de la nota mínima'
  document.getElementById('res-sub').textContent   = pass
    ? `Obtuviste ${nota}/20 (${correctas} de ${total} correctas). ¡Continúa con la siguiente clase!`
    : `Obtuviste ${nota}/20. Tu nota final del curso es el promedio de todos los quizzes (mínimo ${NOTA_MINIMA}).`

  const repaso = aciertos.map((ok, i) => `
    <div class="rb rb-q">
      <span>${i + 1}. ${esc(preguntas[i] || 'Pregunta')}</span>
      <strong style="color:${ok ? '#1a7a35' : 'var(--red)'}"><i class="fa-solid ${ok ? 'fa-check' : 'fa-xmark'}" aria-label="${ok ? 'Correcta' : 'Incorrecta'}"></i></strong>
    </div>`).join('')

  document.getElementById('res-bd').innerHTML = `
    <div class="rb"><span>Respuestas correctas</span><strong>${correctas} / ${total}</strong></div>
    <div class="rb"><span>Nota de este intento</span><strong>${nota}/20</strong></div>
    ${mejor_nota !== undefined && mejor_nota !== null ? `<div class="rb"><span>Tu mejor nota</span><strong>${esc(mejor_nota)}/20</strong></div>` : ''}
    <div class="rb"><span>Nota mínima</span><strong>${NOTA_MINIMA}/20</strong></div>
    ${repaso ? `<div class="rb-sep">Repaso</div>${repaso}` : ''}`
  document.getElementById('btn-aula')?.addEventListener('click', () => { window.location.href = 'aula.html' })
  document.getElementById('btn-inicio')?.addEventListener('click', () => { window.location.href = 'catalogo.html' })
}

const page = document.body.dataset.page
switch (page) {
  case 'landing':   initLanding();   break
  case 'perfil':    initPerfil();    break
  case 'pendiente': initPendiente(); break
  case 'catalogo':  initCatalogo();  break
  case 'curso':     initCurso();     break
  case 'aula':      initBotonesAula(); initAula(); break
  case 'quiz':      initQuiz();      break
  case 'resultado': initResultado(); break
}
