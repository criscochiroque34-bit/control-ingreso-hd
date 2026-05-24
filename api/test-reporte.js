// Endpoint de prueba — usa datos de HOY
import { db, transporter, GMAIL, fechaLabel, calcTiempoTrabajado, esTurnoNoche, getCorreosHD, getCorreosEmpresas, calcBreakMin, calcBanio, tablaPersonal } from './_helpers.js'

const hoy = () => {
  const lima = new Date(Date.now() - 5 * 60 * 60 * 1000)
  if (lima.getUTCHours() < 6) lima.setUTCDate(lima.getUTCDate() - 1)
  return lima.toISOString().slice(0, 10)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  try {
    const fecha = hoy()
    const fechaStr = fechaLabel(fecha)
    const [empresasCorreos, correosHD] = await Promise.all([getCorreosEmpresas(), getCorreosHD()])
    const { data: registros } = await db.from('estado_hoy').select('*').eq('fecha', fecha)
    const empresas = [...new Set(empresasCorreos.map(e => e.empresa))]
    const resultados = []

    for (const empresa of empresas) {
      const correosDest = empresasCorreos.filter(e => e.empresa === empresa)
      const personal = (registros||[]).filter(r => r.empresa === empresa)
      if (!personal.length) { resultados.push({ empresa, enviado: false, razon: 'Sin registros' }); continue }
      const conSalida = personal.filter(p => p.salida).length
      const sinSalida = personal.length - conSalida
      const nombreContacto = correosDest[0]?.nombre_contacto || empresa

      for (const p of personal) {
        const breakMin = await calcBreakMin(p.dni, fecha)
        const { veces: banioVeces, mins: banioMin } = await calcBanio(p.dni, fecha)
        const trabajadoMin = calcTiempoTrabajado(p.ingreso, p.salida, breakMin)
        p._breakStr = breakMin > 0 ? `${(breakMin/60).toFixed(1)}h` : '—'
        p._banioStr = banioVeces > 0 ? `${banioVeces}v/${banioMin}min` : '—'
        p._trabajadoMin = trabajadoMin
      }

      const html = `<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
        <div style="background:#1e2433;padding:18px 24px;border-radius:8px 8px 0 0">
          <div style="font-size:16px;font-weight:bold;color:#fff">🧪 PRUEBA · ${empresa} · ${fechaStr}</div>
          <div style="font-size:11px;color:#9aa3b8;margin-top:3px">Control de Ingreso · Home Delivery</div>
        </div>
        <div style="background:#f7f9fc;padding:20px 24px;border-radius:0 0 8px 8px;border:1px solid #dde2ed;border-top:none">
          <p style="color:#e85d9b;font-size:12px;font-weight:600;margin:0 0 12px">⚠️ Correo de prueba con datos del día actual</p>
          <p style="margin:0 0 16px;color:#1e2433;font-size:14px">Hola <strong>${nombreContacto}</strong></p>
          <div style="display:flex;gap:10px;margin-bottom:16px">
            <div style="flex:1;background:#fff;border:1px solid #dde2ed;border-radius:8px;padding:10px;text-align:center"><div style="font-size:22px;font-weight:bold">${personal.length}</div><div style="font-size:10px;color:#7a8299;text-transform:uppercase">Asistieron</div></div>
            <div style="flex:1;background:#fff;border:1px solid #dde2ed;border-radius:8px;padding:10px;text-align:center"><div style="font-size:22px;font-weight:bold;color:#22c27a">${conSalida}</div><div style="font-size:10px;color:#7a8299;text-transform:uppercase">Salida completa</div></div>
            <div style="flex:1;background:#fff;border:1px solid #dde2ed;border-radius:8px;padding:10px;text-align:center"><div style="font-size:22px;font-weight:bold;color:#e85d9b">${sinSalida}</div><div style="font-size:10px;color:#7a8299;text-transform:uppercase">Sin salida</div></div>
          </div>
          <div style="background:#fff;border:1px solid #dde2ed;border-radius:8px;overflow:hidden">${tablaPersonal(personal)}</div>
        </div>
      </div>`

      await transporter.sendMail({ from: `"Control HD" <${GMAIL}>`, to: correosDest.map(c=>c.correo).join(', '), subject: `🧪 PRUEBA · Reporte · ${empresa} · ${fechaStr}`, html })
      resultados.push({ empresa, enviado: true })
    }

    if (correosHD.length) {
      await transporter.sendMail({ from: `"Control HD" <${GMAIL}>`, to: correosHD.join(', '), subject: `🧪 PRUEBA · Resumen HD · ${fechaStr}`, html: `<p style="font-family:Arial;padding:20px">Prueba correcta — ${fechaStr}. Recibirás los reportes automáticos en los horarios configurados.</p>` })
    }

    return res.status(200).json({ ok: true, resultados })
  } catch(e) { return res.status(500).json({ error: e.message }) }
}
