import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0'

const SUPABASE_URL = 'https://uxytghsxafpjxsjedfvz.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eXRnaHN4YWZwanhzamVkZnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNzI3ODEsImV4cCI6MjA4OTk0ODc4MX0.jbPSwkZZInyQ30NOsRwARoImXBpFzM-4UJbStPCMacg'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)

export async function loginConGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {

      redirectTo: new URL('catalogo.html', window.location.href).href,
      queryParams: { prompt: 'select_account' },
    }
  })
}

export async function cerrarSesion() {
  await supabase.auth.signOut()
  window.location.href = 'index.html'
}

export async function getUsuario() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function getPerfil(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) console.error('Error getPerfil:', error.message)
  return data
}

export async function actualizarPerfil(userId, datos) {
  const { data, error } = await supabase
    .from('profiles')
    .update(datos)
    .eq('id', userId)
  if (error) console.error('Error actualizarPerfil:', error.message)
  return { data, error }
}

export async function getCursos(perfil) {
  const { data, error } = await supabase
    .from('courses')
    .select(`*, course_profiles!inner(perfil)`)
    .eq('course_profiles.perfil', perfil)
    .eq('activo', true)
    .order('orden')
  if (error) console.error('Error getCursos:', error.message)
  return data || []
}

export async function getModulos(courseId) {
  const { data, error } = await supabase
    .from('modules')
    .select('*')
    .eq('course_id', courseId)
    .order('orden')
  if (error) console.error('Error getModulos:', error.message)
  return data || []
}

export async function getCurso(courseId) {
  const { data, error } = await supabase
    .from('courses')
    .select('id, titulo, descripcion, requiere_trabajo, imagen_url')
    .eq('id', courseId)
    .maybeSingle()
  if (error) console.error('Error getCurso:', error.message)
  return data
}

export async function getClasesDelCurso(moduleIds) {
  if (!moduleIds.length) return []
  const { data, error } = await supabase
    .from('classes')
    .select('*')
    .in('module_id', moduleIds)
    .order('orden')
  if (error) console.error('Error getClasesDelCurso:', error.message)
  return data || []
}

export async function getClases(moduleId) {
  const { data, error } = await supabase
    .from('classes')
    .select('*')
    .eq('module_id', moduleId)
    .order('orden')
  if (error) console.error('Error getClases:', error.message)
  return data || []
}

export async function getProgreso(userId, courseId) {
  const { data, error } = await supabase
    .from('progress')
    .select(`*, classes!inner(module_id, modules!inner(course_id))`)
    .eq('user_id', userId)
    .eq('classes.modules.course_id', courseId)
  if (error) console.error('Error getProgreso:', error.message)
  return data || []
}

export async function claseCompletada(userId, classId) {
  const { data } = await supabase
    .from('progress')
    .select('completada')
    .eq('user_id', userId)
    .eq('class_id', classId)
    .maybeSingle()
  return data?.completada || false
}

export async function getQuizPreguntas(classId) {

  const { data, error } = await supabase
    .from('quiz_questions')
    .select('id, class_id, pregunta, opciones, puntos, orden')
    .eq('class_id', classId)
    .order('orden')
    .order('id')
  if (error) console.error('Error getQuizPreguntas:', error.message)
  return data || []
}

export async function iniciarQuiz(classId) {
  const { data, error } = await supabase.rpc('iniciar_quiz', { p_class_id: classId })
  if (error) console.error('Error iniciar_quiz:', error.message)
  return { data, error }
}

export async function guardarRespuestasQuiz(classId, respuestas) {
  const { error } = await supabase.rpc('guardar_respuestas_quiz', { p_class_id: classId, p_respuestas: respuestas })
  if (error) console.warn('guardar_respuestas_quiz:', error.message)
}

export async function finalizarMisQuizzesVencidos() {
  const { error } = await supabase.rpc('finalizar_mis_quizzes_vencidos')
  if (error) console.warn('finalizar_mis_quizzes_vencidos:', error.message)
}

export async function calificarQuiz(classId, respuestas) {
  const { data, error } = await supabase.rpc('calificar_quiz', {
    p_class_id: classId,
    p_respuestas: respuestas
  })
  if (error) console.error('Error calificarQuiz:', error.message)
  return { data, error }
}

export async function getMejorNota(userId, classId) {
  const { data } = await supabase
    .from('quiz_results')
    .select('nota, intentos')
    .eq('user_id', userId)
    .eq('class_id', classId)
    .order('nota', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data || null
}

export async function getNotasQuizCurso(userId, classIds) {
  if (!classIds.length) return []
  const { data, error } = await supabase
    .from('quiz_results')
    .select('class_id, nota')
    .eq('user_id', userId)
    .in('class_id', classIds)
  if (error) console.error('Error getNotasQuizCurso:', error.message)
  return data || []
}

export async function getMisClases(courseId) {
  const { data, error } = await supabase.rpc('mis_clases', { p_course_id: courseId })
  if (error) console.error('Error mis_clases:', error.message)
  return data || []
}

export async function getMiResultado(courseId) {
  const { data, error } = await supabase.rpc('mi_resultado_curso', { p_course_id: courseId })
  if (error) console.error('Error mi_resultado_curso:', error.message)
  return data || null
}

export async function registrarAvance(classId, segundos, marcar = false) {
  const { data, error } = await supabase.rpc('registrar_avance', {
    p_class_id: classId, p_segundos: Math.max(0, Math.floor(segundos || 0)), p_marcar: marcar,
  })
  if (error) console.warn('registrar_avance:', error.message)
  return { data, error }
}

export async function reiniciarCurso(courseId) {
  const { data, error } = await supabase.rpc('reiniciar_curso', { p_course_id: courseId })
  if (error) console.error('Error reiniciar_curso:', error.message)
  return { data, error }
}

export async function entregarTrabajo(userId, courseId, enlace) {
  const { data, error } = await supabase
    .from('exam_submissions')
    .insert({ user_id: userId, course_id: courseId, enlace_url: enlace, estado: 'pendiente' })
  if (error) console.error('Error entregar trabajo:', error.message)
  return { data, error }
}

export async function getExamen(userId, courseId) {
  const { data } = await supabase
    .from('exam_submissions')
    .select('*')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data || null
}

export async function getCertificado(userId, courseId) {
  const { data } = await supabase
    .from('certificates')
    .select('*')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .maybeSingle()
  return data || null
}

export async function getMisCertificados(userId) {
  const { data, error } = await supabase
    .from('certificates')
    .select(`*, courses(titulo)`)
    .eq('user_id', userId)
    .eq('aprobado', true)
  if (error) console.error('Error getCertificados:', error.message)
  return data || []
}

export async function getMisMatriculas(userId) {
  const { data, error } = await supabase
    .from('enrollments')
    .select('*, courses(id, titulo, descripcion, orden)')
    .eq('user_id', userId)
    .order('fecha_matricula', { ascending: false })
  if (error) console.error('getMisMatriculas:', error.message)
  return data || []
}

export async function getMatricula(userId, courseId) {
  const { data } = await supabase
    .from('enrollments')
    .select('id, estado')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .maybeSingle()
  return data || null
}

export async function marcarEnProgreso(userId, courseId) {
  const { error } = await supabase
    .from('enrollments')
    .update({ estado: 'en_progreso' })
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .eq('estado', 'matriculado')
  if (error) console.warn('marcarEnProgreso (revisar RLS de enrollments):', error.message)
}

export async function matricularse(userId, courseId) {
  const { data, error } = await supabase
    .from('enrollments')
    .insert({ user_id: userId, course_id: courseId, estado: 'matriculado' })
  if (error) console.error('matricularse:', error.message)
  return { data, error }
}

export async function enviarConsulta(userId, classId, pregunta) {
  const { data, error } = await supabase
    .from('consultations')
    .insert({ user_id: userId, class_id: classId, pregunta })
  if (error) console.error('Error enviarConsulta:', error.message)
  return { data, error }
}

export async function getConsultas(userId, classId) {
  const { data, error } = await supabase
    .from('consultations')
    .select('*')
    .eq('user_id', userId)
    .eq('class_id', classId)
    .order('created_at', { ascending: false })
  if (error) console.error('Error getConsultas:', error.message)
  return data || []
}
