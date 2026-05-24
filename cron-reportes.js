import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://lflenisloinbqyuptxzc.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxmbGVuaXNsb2luYnF5dXB0eHpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MzAxNDQsImV4cCI6MjA5MTEwNjE0NH0.jcjKs2xCgxf4mvGbf9a5eRETWAOKf0SXg_JC0iy4UsI'
const GMAIL_USER = 'hdoperacionqolqas@gmail.com'
const GMAIL_PASS = 'weyt zxke xzey ushf'

const db = createClient(SUPABASE_URL, SUPABASE_KEY)

// Fecha de ayer en Lima (UTC-5)
const ayer = () => {
  const lima = new Date(Date.now() - 5 * 60 * 60 * 1000)
  lima.setUTCDate(lima.getUTCDate() - 1)
  return lima.toISOString().slice(0, 10)
}

const fechaLabel = (fecha) => {
  const [y, m, d] = fecha.split('-')
  return `${d}/${m}/${y}`
}

const fmtMin = m => m < 60 ? `${m} min` : `${Math.floor(m/60)}h ${m%60}min`

export default async function handler(req, res) {
  // Verificar que es llamada del cron de Vercel
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const fechaAyer = ayer()
    const fechaStr = fechaLabel(fechaAyer)

    // 1. Traer todas las empresas con correos registrados
    const { data: empresasCorreos } = await db
      .from('empresas_correos')
      .select('*')

    if (!empresasCorreos?.length) {
      return res.status(200).json({ message: 'Sin correos registrados' })
    }

    // 2. Traer todos los registros de ayer
    const { data: registros } = await db
      .from('estado_hoy')
      .select('*')
      .eq('fecha', fechaAyer)

    // 3. Traer eventos de ayer para calcular break y baño
    const { data: eventos } = await db
      .from('eventos')
      .select('*')
      .gte('fecha_iso', fechaAyer + 'T05:00:00Z')
      .lt('fecha_iso', new Date(Date.now() - 5*60*60*1000).toISOString().slice(0,10) + 'T05:00:00Z')

    // 4. Configurar transporter Gmail SMTP
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_PASS.replace(/\s/g, '')
      }
    })

    // 5. Agrupar empresas únicas
    const empresas = [...new Set(empresasCorreos.map(e => e.empresa))]
    const resultados = []

    for (const empresa of empresas) {
      const correosDest = empresasCorreos.filter(e => e.empresa === empresa)
      const personal = (registros || []).filter(r => r.empresa === empresa)

      if (!personal.length) continue // Sin registros para esta empresa

      // Verificar si hay pendientes sin salida
      const sinSalida = personal.filter(p => !p.salida || p.estado !== 'salida')

      let asunto, html

      if (sinSalida.length > 0) {
        // Modo B: notificar pendientes sin mandar reporte completo
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
              <p style="color:#1e2433;font-size:14px;margin:0 0 16px">
                Se detectaron <strong>${sinSalida.length} persona${sinSalida.length>1?'s':''} sin salida registrada</strong> 
                del turno del ${fechaStr}. El reporte completo no será enviado hasta que se completen los registros.
              </p>
              <div style="background:#fff;border:1px solid #fde68a;border-radius:8px;overflow:hidden;margin-bottom:16px">
                <table style="width:100%;border-collapse:collapse;font-size:13px">
                  <thead>
                    <tr style="background:#1e2433">
                      <th style="padding:8px 12px;color:#fff;text-align:left">Nombre</th>
                      <th style="padding:8px 12px;color:#fff;text-align:left">DNI</th>
                      <th style="padding:8px 12px;color:#fff;text-align:left">Ingreso</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${sinSalida.map((p,i) => `
                      <tr style="background:${i%2===0?'#fffbf0':'#fff'}">
                        <td style="padding:8px 12px;color:#1e2433">${p.nombre}</td>
                        <td style="padding:8px 12px;color:#1e2433;font-family:monospace">${p.dni}</td>
                        <td style="padding:8px 12px;color:#1e2433">${p.ingreso?.split(' ').slice(-1)[0]||'—'}</td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>
              <p style="color:#92400e;font-size:12px;margin:0">Por favor comuníquese con el operador HD para regularizar los registros.</p>
            </div>
          </div>`
      } else {
        // Modo normal: reporte completo
        const nombreContacto = correosDest[0]?.nombre_contacto || empresa
        const conSalida = personal.filter(p => p.salida).length
        asunto = `Reporte de asistencia · ${empresa} · ${fechaStr}`

        const filas = personal.map((p, i) => {
          // Calcular break
          const evBO = (eventos||[]).filter(e=>e.dni===p.dni&&e.tipo==='break_salida')
          const evBI = (eventos||[]).filter(e=>e.dni===p.dni&&e.tipo==='break_retorno')
          let breakStr = '—'
          if (evBO.length && evBI.length) {
            try {
              const mins = Math.round((new Date(evBI[0].fecha_iso)-new Date(evBO[0].fecha_iso))/60000)
              breakStr = `✓ ${fmtMin(mins)}`
            } catch { breakStr = '✓' }
          } else if (evBO.length) {
            breakStr = '✓ Sin retorno'
          }

          // Calcular baño
          const evBOut = (eventos||[]).filter(e=>e.dni===p.dni&&e.tipo==='banio_salida')
          const evBIn = (eventos||[]).filter(e=>e.dni===p.dni&&e.tipo==='banio_retorno')
          let banioMin = 0
          evBOut.forEach((bo,j)=>{ const bi=evBIn[j]; if(bi){ banioMin+=Math.round((new Date(bi.fecha_iso)-new Date(bo.fecha_iso))/60000) }})
          const banioStr = evBOut.length===0 ? '—' : `${evBOut.length} ${evBOut.length===1?'vez':'veces'}${banioMin>0?' / '+fmtMin(banioMin):''}`

          const horaIngreso = p.ingreso?.split(' ').slice(-1)[0]||'—'
          const horaSalida = p.salida?.split(' ').slice(-1)[0]||'⚠️ Sin salida'

          return `<tr style="background:${i%2===0?'#f7f9fc':'#fff'}">
            <td style="padding:8px 12px;color:#1e2433;font-family:monospace">${p.dni}</td>
            <td style="padding:8px 12px;color:#1e2433">${p.nombre}</td>
            <td style="padding:8px 12px;color:#1e2433;text-align:center">${horaIngreso}</td>
            <td style="padding:8px 12px;color:${!p.salida?'#dc2626':'#1e2433'};text-align:center">${horaSalida}</td>
            <td style="padding:8px 12px;color:#1e2433;text-align:center">${breakStr}</td>
            <td style="padding:8px 12px;color:#1e2433;text-align:center">${banioStr}</td>
          </tr>`
        }).join('')

        html = `
          <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto">
            <div style="background:#1e2433;padding:18px 24px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-size:16px;font-weight:bold;color:#fff">Reporte de Asistencia · ${empresa}</div>
                <div style="font-size:11px;color:#9aa3b8;margin-top:3px">Control de Ingreso · Home Delivery · ${fechaStr}</div>
              </div>
            </div>
            <div style="background:#f7f9fc;padding:20px 24px;border:1px solid #dde2ed;border-top:none">
              <p style="color:#1e2433;font-size:14px;margin:0 0 16px">Hola <strong>${nombreContacto}</strong>, se adjunta el reporte de asistencia del ${fechaStr}.</p>
              <div style="display:flex;gap:12px;margin-bottom:16px">
                <div style="flex:1;background:#fff;border:1px solid #dde2ed;border-radius:8px;padding:12px;text-align:center">
                  <div style="font-size:24px;font-weight:bold;color:#1e2433">${personal.length}</div>
                  <div style="font-size:11px;color:#7a8299;text-transform:uppercase">Asistieron</div>
                </div>
                <div style="flex:1;background:#fff;border:1px solid #dde2ed;border-radius:8px;padding:12px;text-align:center">
                  <div style="font-size:24px;font-weight:bold;color:#22c27a">${conSalida}</div>
                  <div style="font-size:11px;color:#7a8299;text-transform:uppercase">Salida completa</div>
                </div>
                <div style="flex:1;background:#fff;border:1px solid #dde2ed;border-radius:8px;padding:12px;text-align:center">
                  <div style="font-size:24px;font-weight:bold;color:#e85d9b">${personal.length-conSalida}</div>
                  <div style="font-size:11px;color:#7a8299;text-transform:uppercase">Sin salida</div>
                </div>
              </div>
              <div style="background:#fff;border:1px solid #dde2ed;border-radius:8px;overflow:hidden">
                <table style="width:100%;border-collapse:collapse;font-size:13px">
                  <thead>
                    <tr style="background:#1e2433">
                      <th style="padding:8px 12px;color:#fff;text-align:left">DNI</th>
                      <th style="padding:8px 12px;color:#fff;text-align:left">Nombre</th>
                      <th style="padding:8px 12px;color:#fff;text-align:center">Ingreso</th>
                      <th style="padding:8px 12px;color:#fff;text-align:center">Salida</th>
                      <th style="padding:8px 12px;color:#fff;text-align:center">Break</th>
                      <th style="padding:8px 12px;color:#fff;text-align:center">Baño</th>
                    </tr>
                  </thead>
                  <tbody>${filas}</tbody>
                </table>
              </div>
              <p style="color:#7a8299;font-size:11px;margin:16px 0 0">Generado automáticamente · Control de Ingreso HD · ${fechaStr}</p>
            </div>
          </div>`
      }

      // 6. Enviar a todos los correos de la empresa
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
    console.error('Cron error:', error)
    return res.status(500).json({ error: error.message })
  }
}
