import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://lflenisloinbqyuptxzc.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxmbGVuaXNsb2luYnF5dXB0eHpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MzAxNDQsImV4cCI6MjA5MTEwNjE0NH0.jcjKs2xCgxf4mvGbf9a5eRETWAOKf0SXg_JC0iy4UsI'
const GMAIL_USER = 'hdoperacionqolqas@gmail.com'
const GMAIL_PASS = 'weytzxkexzeyushf'

export const db = createClient(SUPABASE_URL, SUPABASE_KEY)

export const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_PASS }
})

export const GMAIL = GMAIL_USER

export const fechaLabel = f => {
  const [y,m,d] = f.split('-')
  return `${d}/${m}/${y}`
}

export const fmtMin = m => {
  if (!m && m !== 0) return '—'
  return (m / 60).toFixed(1).replace('.0','')
}

export const calcTiempoTrabajado = (ingreso, salida, breakMin) => {
  if (!ingreso || !salida) return null
  try {
    // Extraer solo HH:MM de cada string (formato "DD/MM/YYYY HH:MM")
    const minutosDelDia = s => {
      const h = s.split(' ').slice(-1)[0]  // último token = "HH:MM"
      const [hh, mm] = h.split(':').map(Number)
      if (isNaN(hh) || isNaN(mm)) return null
      return hh * 60 + mm
    }
    const mIng = minutosDelDia(ingreso)
    const mSal = minutosDelDia(salida)
    if (mIng === null || mSal === null) return null

    // Si la salida es menor que el ingreso, cruzó UNA medianoche (turno noche)
    let diffMin = mSal - mIng
    if (diffMin < 0) diffMin += 24 * 60

    // El break solo resta si es positivo (protección contra datos corruptos)
    const brk = (breakMin && breakMin > 0) ? breakMin : 0
    const trabajado = diffMin - brk
    return Math.max(0, trabajado)
  } catch { return null }
}

export const esTurnoNoche = ingreso => {
  if (!ingreso) return false
  const h = parseInt(ingreso.split(' ')[1]?.split(':')[0] || '0')
  return h >= 21 || h < 6
}

// Traer correos del equipo HD desde hd_config
export async function getCorreosHD() {
  const { data, error } = await db.from('hd_config').select('valor').ilike('clave', 'correo_hd%')
  console.log('HD correos:', data, error)
  return (data || []).map(r => r.valor).filter(Boolean)
}

// Traer correos de empresas
export async function getCorreosEmpresas() {
  const { data } = await db.from('empresas_correos').select('*')
  return data || []
}

// Calcular break en minutos desde eventos — ventana 6am-6am Lima (cubre turno noche completo)
export async function calcBreakMin(dni, fechaIso) {
  const fechaSig = (() => {
    const d = new Date(fechaIso + 'T11:00:00Z')
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0,10)
  })()
  const { data: evs } = await db.from('eventos').select('*')
    .eq('dni', dni)
    .gte('fecha_iso', fechaIso + 'T11:00:00Z')
    .lt('fecha_iso', fechaSig + 'T11:00:00Z')
  const salidas = (evs||[]).filter(e=>e.tipo==='break_salida').sort((a,b)=>a.fecha_iso>b.fecha_iso?1:-1)
  const retornos = (evs||[]).filter(e=>e.tipo==='break_retorno').sort((a,b)=>a.fecha_iso>b.fecha_iso?1:-1)
  let mins = 0
  salidas.forEach((s,i) => {
    const r = retornos[i]
    if (r) mins += Math.round((new Date(r.fecha_iso) - new Date(s.fecha_iso)) / 60000)
  })
  return mins
}

// Calcular baño desde eventos — ventana 6am-6am Lima
export async function calcBanio(dni, fechaIso) {
  const fechaSig = (() => {
    const d = new Date(fechaIso + 'T11:00:00Z')
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0,10)
  })()
  const { data: evs } = await db.from('eventos').select('*')
    .eq('dni', dni)
    .gte('fecha_iso', fechaIso + 'T11:00:00Z')
    .lt('fecha_iso', fechaSig + 'T11:00:00Z')
  const salidas = (evs||[]).filter(e=>e.tipo==='banio_salida').sort((a,b)=>a.fecha_iso>b.fecha_iso?1:-1)
  const retornos = (evs||[]).filter(e=>e.tipo==='banio_retorno').sort((a,b)=>a.fecha_iso>b.fecha_iso?1:-1)
  let mins = 0
  salidas.forEach((s,i) => {
    const r = retornos[i]
    if (r) mins += Math.round((new Date(r.fecha_iso) - new Date(s.fecha_iso)) / 60000)
  })
  return { veces: salidas.length, mins }
}

// Versión optimizada: traer TODOS los eventos de la jornada en una sola query
export async function getEventosFecha(fechaIso) {
  const fechaSig = (() => {
    const d = new Date(fechaIso + 'T11:00:00Z')
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0,10)
  })()
  const { data } = await db.from('eventos').select('*')
    .gte('fecha_iso', fechaIso + 'T11:00:00Z')
    .lt('fecha_iso', fechaSig + 'T11:00:00Z')
  return data || []
}

export function calcBreakMinLocal(dni, eventos) {
  const salidas = eventos.filter(e=>e.dni===dni&&e.tipo==='break_salida').sort((a,b)=>a.fecha_iso>b.fecha_iso?1:-1)
  const retornos = eventos.filter(e=>e.dni===dni&&e.tipo==='break_retorno').sort((a,b)=>a.fecha_iso>b.fecha_iso?1:-1)
  let mins = 0
  salidas.forEach((s,i) => { const r=retornos[i]; if(r) mins+=Math.round((new Date(r.fecha_iso)-new Date(s.fecha_iso))/60000) })
  return mins
}

export function calcBanioLocal(dni, eventos) {
  const salidas = eventos.filter(e=>e.dni===dni&&e.tipo==='banio_salida').sort((a,b)=>a.fecha_iso>b.fecha_iso?1:-1)
  const retornos = eventos.filter(e=>e.dni===dni&&e.tipo==='banio_retorno').sort((a,b)=>a.fecha_iso>b.fecha_iso?1:-1)
  let mins = 0
  salidas.forEach((s,i) => { const r=retornos[i]; if(r) mins+=Math.round((new Date(r.fecha_iso)-new Date(s.fecha_iso))/60000) })
  return { veces: salidas.length, mins }
}

// Generar HTML de tabla de personal
export function tablaPersonal(personal, conTiempo = true) {
  if (!personal.length) return '<p style="color:#7a8299;font-size:13px">Sin registros</p>'
  const totalMin = personal.reduce((acc, p) => acc + (p._trabajadoMin || 0), 0)
  const totalHrs = totalMin > 0 ? (totalMin/60).toFixed(1) : '—'

  const filas = personal.map((p, i) => `
    <tr style="background:${i%2===0?'#f7f9fc':'#fff'}">
      <td style="padding:8px 10px;font-family:monospace;font-size:12px">${p.dni}</td>
      <td style="padding:8px 10px;font-size:13px">${p.nombre}</td>
      <td style="padding:8px 10px;text-align:center;font-size:12px">${p.ingreso?.split(' ').slice(-1)[0]||'—'}</td>
      <td style="padding:8px 10px;text-align:center;font-size:12px;color:${!p.salida?'#dc2626':'#1e2433'}">${p.salida?.split(' ').slice(-1)[0]||'⚠️'}</td>
      <td style="padding:8px 10px;text-align:center;font-size:12px">${p._breakStr||'—'}</td>
      <td style="padding:8px 10px;text-align:center;font-size:12px">${p._banioStr||'—'}</td>
      ${conTiempo ? `<td style="padding:8px 10px;text-align:center;font-size:12px;font-weight:600">${p._trabajadoMin ? (p._trabajadoMin/60).toFixed(1)+'h' : '—'}</td>` : ''}
    </tr>`).join('')

  return `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#1e2433">
          <th style="padding:8px 10px;color:#fff;text-align:left;font-size:11px">DNI</th>
          <th style="padding:8px 10px;color:#fff;text-align:left;font-size:11px">Nombre</th>
          <th style="padding:8px 10px;color:#fff;text-align:center;font-size:11px">Ingreso</th>
          <th style="padding:8px 10px;color:#fff;text-align:center;font-size:11px">Salida</th>
          <th style="padding:8px 10px;color:#fff;text-align:center;font-size:11px">Tiempo Break</th>
          <th style="padding:8px 10px;color:#fff;text-align:center;font-size:11px">Baño</th>
          ${conTiempo ? '<th style="padding:8px 10px;color:#fff;text-align:center;font-size:11px">Horas trab.</th>' : ''}
        </tr>
      </thead>
      <tbody>${filas}</tbody>
      ${conTiempo && totalMin > 0 ? `
      <tfoot>
        <tr style="background:#1e2433">
          <td colspan="6" style="padding:8px 10px;color:#9aa3b8;font-size:11px;text-align:right;font-weight:600">TOTAL GRUPO</td>
          <td style="padding:8px 10px;color:#22c27a;text-align:center;font-size:13px;font-weight:700">${totalHrs}h</td>
        </tr>
      </tfoot>` : ''}
    </table>`
}
