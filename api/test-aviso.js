import { db, transporter, GMAIL, fechaLabel, getCorreosHD } from './_helpers.js'

const hoy = () => {
  const lima = new Date(Date.now() - 5 * 60 * 60 * 1000)
  return lima.toISOString().slice(0, 10)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  try {
    const fecha = hoy()
    const fechaStr = fechaLabel(fecha)
    const correosHD = await getCorreosHD()
    if (!correosHD.length) return res.status(200).json({ ok: true, message: 'Sin correos HD en hd_config' })

    const { data: registros } = await db.from('estado_hoy').select('*').eq('fecha', fecha)
    const pendientes = (registros||[]).filter(p => !p.salida || p.estado !== 'salida')

    const porEmpresa = {}
    pendientes.forEach(p => {
      if (!porEmpresa[p.empresa]) porEmpresa[p.empresa] = []
      porEmpresa[p.empresa].push(p)
    })

    const secciones = Object.entries(porEmpresa).map(([empresa, personas]) => `
      <div style="margin-bottom:14px">
        <div style="font-weight:bold;color:#92400e;font-size:13px;margin-bottom:6px">${empresa} — ${personas.length} pendiente${personas.length>1?'s':''}</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#1e2433">
            <th style="padding:6px 10px;color:#fff;text-align:left">Nombre</th>
            <th style="padding:6px 10px;color:#fff;text-align:left">DNI</th>
            <th style="padding:6px 10px;color:#fff;text-align:center">Ingreso</th>
          </tr></thead>
          <tbody>${personas.map((p,i)=>`<tr style="background:${i%2===0?'#fffbf0':'#fff'}">
            <td style="padding:6px 10px">${p.nombre}</td>
            <td style="padding:6px 10px;font-family:monospace">${p.dni}</td>
            <td style="padding:6px 10px;text-align:center">${p.ingreso?.split(' ').slice(-1)[0]||'—'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`).join('')

    const sinPendientes = !pendientes.length
    const html = sinPendientes
      ? `<div style="font-family:Arial;max-width:600px;margin:0 auto;padding:24px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0">
          <p style="color:#065f46;font-size:15px;font-weight:bold">✅ Sin pendientes · ${fechaStr}</p>
          <p style="color:#065f46;font-size:13px;margin-top:8px">Todas las salidas están registradas correctamente.</p>
        </div>`
      : `<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto">
          <div style="background:#1e2433;padding:18px 24px;border-radius:8px 8px 0 0">
            <div style="font-size:16px;font-weight:bold;color:#fff">🧪 PRUEBA AVISO · Pendientes · ${fechaStr}</div>
          </div>
          <div style="background:#fff8f0;padding:20px 24px;border-radius:0 0 8px 8px;border:1px solid #fde68a;border-top:none">
            <p style="color:#e85d9b;font-size:12px;font-weight:600;margin:0 0 12px">⚠️ Correo de prueba</p>
            <p style="color:#1e2433;font-size:14px;margin:0 0 16px">Hay <strong>${pendientes.length} persona${pendientes.length>1?'s':''} sin salida registrada</strong>.</p>
            ${secciones}
          </div>
        </div>`

    await transporter.sendMail({
      from: `"Control HD" <${GMAIL}>`,
      to: correosHD.join(', '),
      subject: sinPendientes ? `✅ Sin pendientes · ${fechaStr}` : `🧪 PRUEBA AVISO · ${pendientes.length} pendiente${pendientes.length>1?'s':''} · ${fechaStr}`,
      html
    })

    return res.status(200).json({ ok: true, enviado: true, pendientes: pendientes.length })
  } catch(e) { return res.status(500).json({ error: e.message }) }
}
