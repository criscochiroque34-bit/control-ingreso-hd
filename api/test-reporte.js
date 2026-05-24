import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://lflenisloinbqyuptxzc.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxmbGVuaXNsb2luYnF5dXB0eHpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MzAxNDQsImV4cCI6MjA5MTEwNjE0NH0.jcjKs2xCgxf4mvGbf9a5eRETWAOKf0SXg_JC0iy4UsI'
const GMAIL_USER = 'hdoperacionqolqas@gmail.com'
const GMAIL_PASS = 'weytzxkexzeyushf'

const db = createClient(SUPABASE_URL, SUPABASE_KEY)

const fechaLabel = (fecha) => {
  const [y,m,d] = fecha.split('-')
  return `${d}/${m}/${y}`
}
const fmtMin = m => m < 60 ? `${m} min` : `${Math.floor(m/60)}h ${m%60}min`

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    // Para prueba usa HOY en vez de ayer
    const lima = new Date(Date.now() - 5 * 60 * 60 * 1000)
    const fechaUsar = lima.toISOString().slice(0, 10)
    const fechaStr = fechaLabel(fechaUsar)

    const { data: empresasCorreos } = await db.from('empresas_correos').select('*')
    if (!empresasCorreos?.length) return res.status(200).json({ message: 'Sin correos registrados' })

    const { data: registros } = await db.from('estado_hoy').select('*').eq('fecha', fechaUsar)
    const { data: eventos } = await db.from('eventos').select('*').gte('fecha_iso', fechaUsar + 'T05:00:00Z')

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_PASS }
    })

    const empresas = [...new Set(empresasCorreos.map(e => e.empresa))]
    const resultados = []

    for (const empresa of empresas) {
      const correosDest = empresasCorreos.filter(e => e.empresa === empresa)
      const personal = (registros || []).filter(r => r.empresa === empresa)
      if (!personal.length) { resultados.push({ empresa, enviado: false, razon: 'Sin registros' }); continue }

      const sinSalida = personal.filter(p => !p.salida || p.estado !== 'salida')
      let asunto, html

      if (sinSalida.length > 0) {
        const nombreContacto = correosDest[0]?.nombre_contacto || empresa
        asunto = `⚠️ Reporte pendiente · ${empresa} · ${fechaStr}`
        html = `
          <div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto">
            <div style="background:#1e2433;padding:18px 24px;border-radius:8px 8px 0 0">
              <div style="font-size:16px;font-weight:bold;color:#fff">⚠️ Salidas pendientes · ${empresa}</div>
              <div style="font-size:11px;color:#9aa3b8;margin-top:3px">Control de Ingreso · Home Delivery · ${fechaStr}</div>
            </div>
            <div style="background:#fff8f0;padding:20px 24px;border-radius:0 0 8px 8px;border:1px solid #fde68a;border-top:none">
              <p style="color:#1e2433;font-size:14px;margin:0 0 12px">Hola <strong>${nombreContacto}</strong>,</p>
              <p style="color:#1e2433;font-size:14px;margin:0 0 16px">Hay <strong>${sinSalida.length} persona${sinSalida.length>1?'s':''} sin salida registrada</strong> del turno del ${fechaStr}.</p>
              <div style="background:#fff;border:1px solid #fde68a;border-radius:8px;overflow:hidden;margin-bottom:16px">
                <table style="width:100%;border-collapse:collapse;font-size:13px">
                  <thead><tr style="background:#1e2433">
                    <th style="padding:8px 12px;color:#fff;text-align:left">Nombre</th>
                    <th style="padding:8px 12px;color:#fff;text-align:left">DNI</th>
                    <th style="padding:8px 12px;color:#fff;text-align:center">Ingreso</th>
                  </tr></thead>
                  <tbody>${sinSalida.map((p,i)=>`
                    <tr style="background:${i%2===0?'#fffbf0':'#fff'}">
                      <td style="padding:8px 12px">${p.nombre}</td>
                      <td style="padding:8px 12px;font-family:monospace">${p.dni}</td>
                      <td style="padding:8px 12px;text-align:center">${p.ingreso?.split(' ').slice(-1)[0]||'—'}</td>
                    </tr>`).join('')}</tbody>
                </table>
              </div>
              <p style="color:#92400e;font-size:12px;margin:0">Comuníquese con el operador HD para regularizar los registros.</p>
            </div>
          </div>`
      } else {
        const nombreContacto = correosDest[0]?.nombre_contacto || empresa
        const conSalida = personal.filter(p => p.salida).length
        asunto = `Reporte de asistencia · ${empresa} · ${fechaStr}`

        const filas = personal.map((p,i) => {
          const evBO = (eventos||[]).filter(e=>e.dni===p.dni&&e.tipo==='break_salida')
          const evBI = (eventos||[]).filter(e=>e.dni===p.dni&&e.tipo==='break_retorno')
          let breakStr = '—'
          if (evBO.length && evBI.length) {
            try { const mins=Math.round((new Date(evBI[0].fecha_iso)-new Date(evBO[0].fecha_iso))/60000); breakStr=`✓ ${fmtMin(mins)}` } catch { breakStr='✓' }
          } else if (evBO.length) breakStr='✓ Sin retorno'

          const evBOut=(eventos||[]).filter(e=>e.dni===p.dni&&e.tipo==='banio_salida')
          const evBIn=(eventos||[]).filter(e=>e.dni===p.dni&&e.tipo==='banio_retorno')
          let banioMin=0
          evBOut.forEach((bo,j)=>{ const bi=evBIn[j]; if(bi) banioMin+=Math.round((new Date(bi.fecha_iso)-new Date(bo.fecha_iso))/60000) })
          const banioStr=evBOut.length===0?'—':`${evBOut.length} ${evBOut.length===1?'vez':'veces'}${banioMin>0?' / '+fmtMin(banioMin):''}`

          return `<tr style="background:${i%2===0?'#f7f9fc':'#fff'}">
            <td style="padding:8px 12px;font-family:monospace">${p.dni}</td>
            <td style="padding:8px 12px">${p.nombre}</td>
            <td style="padding:8px 12px;text-align:center">${p.ingreso?.split(' ').slice(-1)[0]||'—'}</td>
            <td style="padding:8px 12px;text-align:center;color:${!p.salida?'#dc2626':'#1e2433'}">${p.salida?.split(' ').slice(-1)[0]||'⚠️ Sin salida'}</td>
            <td style="padding:8px 12px;text-align:center">${breakStr}</td>
            <td style="padding:8px 12px;text-align:center">${banioStr}</td>
          </tr>`
        }).join('')

        html = `
          <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto">
            <div style="background:#1e2433;padding:18px 24px;border-radius:8px 8px 0 0">
              <div style="font-size:16px;font-weight:bold;color:#fff">Reporte de Asistencia · ${empresa}</div>
              <div style="font-size:11px;color:#9aa3b8;margin-top:3px">Control de Ingreso · Home Delivery · ${fechaStr}</div>
            </div>
            <div style="background:#f7f9fc;padding:20px 24px;border-radius:0 0 8px 8px;border:1px solid #dde2ed;border-top:none">
              <p style="color:#1e2433;font-size:14px;margin:0 0 16px">Hola <strong>${nombreContacto}</strong>, reporte del ${fechaStr}.</p>
              <div style="display:flex;gap:10px;margin-bottom:16px">
                <div style="flex:1;background:#fff;border:1px solid #dde2ed;border-radius:8px;padding:10px;text-align:center">
                  <div style="font-size:22px;font-weight:bold;color:#1e2433">${personal.length}</div>
                  <div style="font-size:10px;color:#7a8299;text-transform:uppercase">Asistieron</div>
                </div>
                <div style="flex:1;background:#fff;border:1px solid #dde2ed;border-radius:8px;padding:10px;text-align:center">
                  <div style="font-size:22px;font-weight:bold;color:#22c27a">${conSalida}</div>
                  <div style="font-size:10px;color:#7a8299;text-transform:uppercase">Salida completa</div>
                </div>
                <div style="flex:1;background:#fff;border:1px solid #dde2ed;border-radius:8px;padding:10px;text-align:center">
                  <div style="font-size:22px;font-weight:bold;color:#e85d9b">${personal.length-conSalida}</div>
                  <div style="font-size:10px;color:#7a8299;text-transform:uppercase">Sin salida</div>
                </div>
              </div>
              <div style="background:#fff;border:1px solid #dde2ed;border-radius:8px;overflow:hidden">
                <table style="width:100%;border-collapse:collapse;font-size:13px">
                  <thead><tr style="background:#1e2433">
                    <th style="padding:8px 12px;color:#fff;text-align:left">DNI</th>
                    <th style="padding:8px 12px;color:#fff;text-align:left">Nombre</th>
                    <th style="padding:8px 12px;color:#fff;text-align:center">Ingreso</th>
                    <th style="padding:8px 12px;color:#fff;text-align:center">Salida</th>
                    <th style="padding:8px 12px;color:#fff;text-align:center">Break</th>
                    <th style="padding:8px 12px;color:#fff;text-align:center">Baño</th>
                  </tr></thead>
                  <tbody>${filas}</tbody>
                </table>
              </div>
              <p style="color:#7a8299;font-size:11px;margin:16px 0 0">Generado automáticamente · Control de Ingreso HD · ${fechaStr}</p>
            </div>
          </div>`
      }

      const destinatarios = correosDest.map(c => c.correo).join(', ')
      await transporter.sendMail({
        from: `"Control HD" <${GMAIL_USER}>`,
        to: destinatarios,
        subject: asunto,
        html
      })

      resultados.push({ empresa, enviado: true, destinatarios })
    }

    return res.status(200).json({ ok: true, resultados })
  } catch (error) {
    console.error('Test error:', error)
    return res.status(500).json({ error: error.message })
  }
}
