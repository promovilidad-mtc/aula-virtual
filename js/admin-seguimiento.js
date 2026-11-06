import { supabase, getUsuario, getPerfil } from './supabase.js?v=202611060003'
import { esc, toast, formatFecha, cargando, urlSegura } from './utils.js?v=202611060003'

const SG = { cursos: [], filas: [], consultas: [] }
const $ = (id) => document.getElementById(id)

const RESULTADO = {
  en_curso:      ['sp-progreso',   'En curso'],
  aprobado:      ['sp-activo',     'Aprobado'],
  desaprobado:   ['sp-rechazado',  'Desaprobado'],
  falta_trabajo: ['sp-pendiente',  'Falta trabajo'],
}
const TRABAJO = {
  pendiente:   'En revisión',
  revisado:    'Conforme',
  aprobado:    'Conforme',
  desaprobado: 'Observado',
}
const PERFIL_CORTO = { autoridades: 'Autoridades', tecnicos: 'Eq. técnico', civil: 'Soc. civil' }

async function init() {
  const usuario = await getUsuario()
  if (!usuario) return
  const perfil = await getPerfil(usuario.id)
  if (!perfil?.es_admin && !perfil?.es_profesor) return

  const { data: cursos } = await supabase.from('courses').select('id, titulo, orden').order('orden').order('created_at')
  SG.cursos = cursos || []
  $('sg-curso').innerHTML = SG.cursos.length
    ? SG.cursos.map(c => `<option value="${esc(c.id)}">${esc(c.titulo)}</option>`).join('')
    : '<option value="">No hay cursos</option>'
  $('sg-curso').addEventListener('change', cargarSeguimiento)
  $('sg-buscar').addEventListener('input', renderSeguimiento)
  $('sg-csv').addEventListener('click', descargarCSV)
  $('tabla-seguimiento').addEventListener('click', onClickSeguimiento)

  $('cs-filtro').addEventListener('change', renderConsultas)
  $('lista-consultas').addEventListener('click', onClickConsultas)

  document.addEventListener('admin:tab', (e) => {
    if (e.detail === 'seguimiento') cargarSeguimiento()
    if (e.detail === 'consultas')   cargarConsultas()
  })
  document.addEventListener('admin:trabajo-revisado', () => {
    if ($('panel-seguimiento')?.classList.contains('active')) cargarSeguimiento()
  })

  await Promise.all([cargarSeguimiento(), cargarConsultas()])
}

async function cargarSeguimiento() {
  const courseId = $('sg-curso').value
  const el = $('tabla-seguimiento')
  if (!courseId) { el.innerHTML = '<div class="empty-state">Crea un curso primero</div>'; return }
  el.innerHTML = '<div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> Calculando avance...</div>'

  await supabase.rpc('admin_finalizar_quizzes_vencidos')
  const { data, error } = await supabase.rpc('admin_seguimiento', { p_course_id: courseId })
  if (error) { el.innerHTML = `<div class="empty-state">Error: ${esc(error.message)}</div>`; return }
  SG.filas = data || []
  renderSeguimiento()
}

function barra(n, total) {
  const pct = total ? Math.round(n / total * 100) : 0
  return `<div style="display:flex;align-items:center;gap:6px">
    <div style="flex:1;height:6px;border-radius:99px;background:var(--gray-100);overflow:hidden;min-width:50px">
      <div style="height:100%;width:${pct}%;background:${pct === 100 ? '#1a7a35' : 'var(--blue)'}"></div>
    </div>
    <span style="font-size:11.5px;color:var(--gray-500);white-space:nowrap">${n}/${total}</span>
  </div>`
}

function renderSeguimiento() {
  const el = $('tabla-seguimiento')
  const q = ($('sg-buscar').value || '').toLowerCase()
  const lista = SG.filas.filter(f => [f.nombre, f.correo, f.institucion].some(v => (v || '').toLowerCase().includes(q)))

  if (!SG.filas.length) { el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-users"></i>Nadie se ha matriculado en este curso todavía</div>'; return }
  if (!lista.length)    { el.innerHTML = '<div class="empty-state">Ningún alumno coincide con la búsqueda</div>'; return }

  const resumen = {
    total: SG.filas.length,
    aprobados: SG.filas.filter(f => f.resultado === 'aprobado').length,
    desaprobados: SG.filas.filter(f => f.resultado === 'desaprobado').length,
    certificados: SG.filas.filter(f => f.certificado).length,
  }

  el.innerHTML = `
    <div style="padding:10px 16px;font-size:12px;color:var(--gray-500);border-bottom:1px solid var(--border)">
      ${resumen.total} matriculado${resumen.total === 1 ? '' : 's'} ·
      ${resumen.aprobados} aprobado${resumen.aprobados === 1 ? '' : 's'} ·
      ${resumen.desaprobados} desaprobado${resumen.desaprobados === 1 ? '' : 's'} ·
      ${resumen.certificados} con certificado
    </div>
    <table class="admin-table">
    <thead><tr>
      <th>Alumno</th><th>Clases</th><th>Quizzes</th><th>Promedio</th>
      <th>Resultado</th><th>Trabajo</th><th>Intento</th><th>Última actividad</th><th>Certificado</th>
    </tr></thead>
    <tbody>
    ${lista.map(f => {
      let [pill, txt] = RESULTADO[f.resultado] || ['sp-inactivo', f.resultado || '—']

      if (f.resultado === 'falta_trabajo' && f.trabajo_estado === 'pendiente')   [pill, txt] = ['sp-progreso', 'Trabajo por revisar']
      if (f.resultado === 'falta_trabajo' && f.trabajo_estado === 'desaprobado') [pill, txt] = ['sp-pendiente', 'Trabajo observado']
      const prom = f.total_quizzes ? (f.promedio ?? 0) : null
      const trabajo = f.trabajo_estado
        ? `${esc(TRABAJO[f.trabajo_estado] || f.trabajo_estado)}${f.trabajo_enlace ? ` · <a href="${esc(urlSegura(f.trabajo_enlace))}" target="_blank" rel="noopener">abrir</a>` : ''}
           <div style="margin-top:4px"><button class="act-btn ${f.trabajo_estado === 'pendiente' ? 'ab-activar' : 'ab-nota'}" data-sg="revisar" data-id="${esc(f.alumno_id)}" style="padding:3px 8px">
             <i class="fa-solid fa-pen"></i> ${f.trabajo_estado === 'pendiente' ? 'Revisar' : 'Cambiar'}</button></div>`
        : '<span style="color:var(--muted)">—</span>'
      const cert = f.certificado
        ? '<span class="sp sp-activo"><i class="fa-solid fa-award"></i> Emitido</span>'
        : f.resultado === 'aprobado'
          ? `<button class="act-btn ab-activar" data-sg="emitir" data-id="${esc(f.alumno_id)}"><i class="fa-solid fa-award"></i> Emitir</button>`
          : '<span style="color:var(--muted);font-size:12px">—</span>'
      return `
      <tr>
        <td>
          <strong>${esc(f.nombre) || '—'}</strong>
          <div style="font-size:11px;color:var(--muted)">${esc(f.correo)}</div>
          <div style="font-size:11px;color:var(--muted)">${esc(PERFIL_CORTO[f.perfil] || f.perfil || '')}${f.institucion ? ' · ' + esc(f.institucion) : ''}</div>
        </td>
        <td>${barra(f.clases_completadas, f.total_clases)}</td>
        <td>${f.total_quizzes ? barra(f.quizzes_rendidos, f.total_quizzes) : '<span style="color:var(--muted);font-size:12px">Sin quizzes</span>'}</td>
        <td style="font-weight:600;color:${prom === null ? 'var(--muted)' : prom >= 12 ? '#1a7a35' : 'var(--red)'}">${prom === null ? '—' : prom + '/20'}</td>
        <td><span class="sp ${pill}">${esc(txt)}</span></td>
        <td style="font-size:12px">${trabajo}</td>
        <td style="font-size:12px">
          ${f.intento}
          ${f.intentos_previos ? `<button class="act-btn ab-ver" data-sg="historial" data-id="${esc(f.alumno_id)}" style="margin-left:4px;padding:2px 7px" title="Ver intentos anteriores"><i class="fa-solid fa-clock-rotate-left"></i> ${f.intentos_previos}</button>` : ''}
        </td>
        <td style="font-size:12px;color:var(--muted)">${formatFecha(f.ultima_actividad)}</td>
        <td>${cert}</td>
      </tr>`
    }).join('')}
    </tbody>
  </table>`
}

async function onClickSeguimiento(e) {
  const b = e.target.closest('[data-sg]')
  if (!b) return
  const courseId = $('sg-curso').value
  const fila = SG.filas.find(f => f.alumno_id === b.dataset.id)
  if (!fila) return

  if (b.dataset.sg === 'revisar') {
    window.revisarTrabajoDe?.(fila.alumno_id, courseId)
    return
  }

  if (b.dataset.sg === 'emitir') {
    if (!confirm(`¿Emitir el certificado de ${fila.nombre || fila.correo}?\n\nCurso: ${$('sg-curso').selectedOptions[0]?.textContent}\nPromedio: ${fila.promedio ?? '—'}/20`)) return
    const restaurar = cargando(b, 'Emitiendo...')
    const { data, error } = await supabase.rpc('emitir_certificado', { p_user_id: fila.alumno_id, p_course_id: courseId })
    restaurar()
    if (error) { toast('No se pudo emitir: ' + error.message, 'wa', 7000); return }
    toast(data || 'Certificado emitido', String(data || '').startsWith('APROBADO') ? 'ok' : 'wa', 7000)
    await cargarSeguimiento()
  }

  if (b.dataset.sg === 'historial') {
    const { data, error } = await supabase
      .from('historial_intentos')
      .select('*')
      .eq('user_id', fila.alumno_id).eq('course_id', courseId)
      .order('intento')
    if (error) { toast('No se pudo cargar el historial: ' + error.message, 'wa'); return }
    const lineas = (data || []).map(h =>
      `Intento ${h.intento} (${formatFecha(h.inicio)} → ${formatFecha(h.fin)}): ` +
      `${h.clases_completadas}/${h.total_clases} clases, ${h.quizzes_rendidos}/${h.total_quizzes} quizzes, ` +
      `promedio ${h.promedio ?? 0}/20 · ${h.resultado}`)
    alert(`Intentos anteriores de ${fila.nombre || fila.correo}:\n\n` + (lineas.join('\n') || 'Sin registros'))
  }
}

function descargarCSV() {
  if (!SG.filas.length) { toast('No hay datos para descargar'); return }
  const curso = $('sg-curso').selectedOptions[0]?.textContent || 'curso'
  const num = (v) => v === null || v === undefined ? '' : String(v).replace('.', ',')
  const cab = ['Alumno', 'Correo', 'Perfil', 'Institución', 'Clases completadas', 'Total clases',
    'Quizzes rendidos', 'Total quizzes', 'Promedio', 'Resultado', 'Trabajo final', 'Intento',
    'Intentos previos', 'Certificado', 'Matriculado el', 'Última actividad']
  const filas = SG.filas.map(f => [
    f.nombre, f.correo, PERFIL_CORTO[f.perfil] || f.perfil, f.institucion,
    f.clases_completadas, f.total_clases, f.quizzes_rendidos, f.total_quizzes,
    f.total_quizzes ? num(f.promedio ?? 0) : '', (RESULTADO[f.resultado] || [, f.resultado])[1],
    TRABAJO[f.trabajo_estado] || '', f.intento, f.intentos_previos, f.certificado ? 'Sí' : 'No',
    formatFecha(f.fecha_matricula), formatFecha(f.ultima_actividad),
  ])
  const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = '﻿' + [cab, ...filas].map(r => r.map(celda).join(';')).join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `Seguimiento - ${curso.slice(0, 60).replace(/[\\/:*?"<>|]/g, '')} - ${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

async function cargarConsultas() {
  const { data, error } = await supabase
    .from('consultations')
    .select('*, profiles(full_name, email), classes(titulo, modules(titulo, courses(titulo)))')
    .order('created_at', { ascending: false })
  if (error) { $('lista-consultas').innerHTML = `<div class="empty-state">Error: ${esc(error.message)}</div>`; return }
  SG.consultas = data || []
  const pendientes = SG.consultas.filter(c => !c.respondida).length
  if ($('badge-cons'))     { $('badge-cons').textContent = pendientes; $('badge-cons').hidden = !pendientes }
  if ($('stat-consultas')) $('stat-consultas').textContent = pendientes
  renderConsultas()
}

function renderConsultas() {
  const el = $('lista-consultas')
  const soloPend = $('cs-filtro').value === 'pendientes'
  const lista = SG.consultas.filter(c => !soloPend || !c.respondida)
  if (!lista.length) {
    el.innerHTML = `<div class="empty-state"><i class="fa-solid fa-comments"></i>${soloPend ? 'No hay consultas sin responder' : 'Todavía no hay consultas'}</div>`
    return
  }
  el.innerHTML = `<ul class="ed-list">${lista.map(c => {
    const cl = c.classes, mod = cl?.modules, cur = mod?.courses
    return `
    <li class="ed-item" style="align-items:flex-start;flex-direction:column;gap:8px">
      <div style="display:flex;justify-content:space-between;width:100%;gap:10px;flex-wrap:wrap">
        <div>
          <strong style="font-size:13px">${esc(c.profiles?.full_name) || esc(c.profiles?.email) || 'Alumno'}</strong>
          <span style="font-size:11.5px;color:var(--muted)"> · ${esc(c.profiles?.email)}</span>
          <div style="font-size:11.5px;color:var(--muted);margin-top:2px">
            ${esc(cur?.titulo || '')} › ${esc(mod?.titulo || '')} › <strong>${esc(cl?.titulo || '')}</strong>
          </div>
        </div>
        <div style="font-size:11.5px;color:var(--muted)">
          ${formatFecha(c.created_at)}
          ${c.respondida ? '<span class="sp sp-activo" style="margin-left:6px">Respondida</span>' : '<span class="sp sp-pendiente" style="margin-left:6px">Sin responder</span>'}
        </div>
      </div>
      <div style="font-size:13px;line-height:1.55;background:var(--gray-50);border:1px solid var(--border);border-radius:var(--r-sm);padding:9px 12px;width:100%;box-sizing:border-box;white-space:pre-line">${esc(c.pregunta)}</div>
      <div style="width:100%" data-caja="${esc(c.id)}">
        ${c.respondida ? `
          <div style="font-size:12.5px;line-height:1.55;border-left:3px solid #1a7a35;padding:4px 10px;white-space:pre-line">${esc(c.respuesta)}</div>
          <div style="font-size:11px;color:var(--muted);margin:4px 0 0 13px">Respondida el ${formatFecha(c.respondida_at)} ·
            <button class="ed-back" data-cs="editar" data-id="${esc(c.id)}" style="margin:0">Editar respuesta</button></div>`
        : formRespuesta(c)}
      </div>
    </li>`
  }).join('')}</ul>`
}

function formRespuesta(c) {
  return `
    <textarea class="cs-resp" rows="3" maxlength="3000" placeholder="Escribe tu respuesta para el alumno..."
      style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid var(--border-hi);border-radius:var(--r-sm);font-family:var(--font);font-size:13px;resize:vertical">${esc(c.respuesta || '')}</textarea>
    <div style="text-align:right;margin-top:6px">
      <button class="act-btn ab-activar" data-cs="responder" data-id="${esc(c.id)}"><i class="fa-solid fa-paper-plane"></i> Enviar respuesta</button>
    </div>`
}

async function onClickConsultas(e) {
  const b = e.target.closest('[data-cs]')
  if (!b) return
  const c = SG.consultas.find(x => x.id === b.dataset.id)
  if (!c) return
  const caja = document.querySelector(`[data-caja="${CSS.escape(c.id)}"]`)

  if (b.dataset.cs === 'editar') {
    caja.innerHTML = formRespuesta(c)
    caja.querySelector('.cs-resp').focus()
    return
  }
  if (b.dataset.cs === 'responder') {
    const txt = caja.querySelector('.cs-resp').value.trim()
    if (!txt) { toast('Escribe la respuesta', 'wa'); return }
    const restaurar = cargando(b, 'Enviando...')
    const { error } = await supabase.from('consultations')
      .update({ respuesta: txt, respondida: true, respondida_at: new Date().toISOString() })
      .eq('id', c.id)
    restaurar()
    if (error) { toast('No se pudo enviar: ' + error.message, 'wa', 6000); return }
    toast('Respuesta enviada. El alumno la verá en la clase.', 'ok')
    await cargarConsultas()
  }
}

init()
