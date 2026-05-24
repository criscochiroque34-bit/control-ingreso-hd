import { db, transporter, GMAIL, fechaLabel, esTurnoNoche, getCorreosHD, getCorreosEmpresas } from './_helpers.js'

const hoy = () => {
  const lima = new Date(Date.now() - 5 * 60 * 60 * 1000)
  return lima.toISOString().slice(0, 10)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  try {
    const fecha = hoy()
    const fechaStr = fechaLabel(fecha)
    const turnoLabel = 'Turno Día'

    const [empresasCorreos, correosHD] = await Promise.all([
      getCorreosEmpresas(),
      getCorreosHD()
    ])

    if (!correosHD.length) return res.status(200).json({ ok: true, message: 'Sin correos HD configurados' })

    const { data: registros } = await db.from('estado_hoy').select('*').eq('fecha', fecha)
    const registrosDia = (registros||[]).filter(r => !esTurnoNoche(r.ingreso))
    const pendientes = registrosDia.filter(p => !p.salida || p.estado !== 'salida')

    if (!pendientes.length) {
      return res.status(200).json({ ok: true, enviado: false, message: 'Sin pendientes — no se envía aviso' })
    }

    // Agrupar pendientes por empresa
    const porEmpresa = {}
    pendientes.forEach(p => {
      if (!porEmpresa[p.empresa]) porEmpresa[p.empresa] = []
      porEmpresa[p.empresa].push(p)
    })

    const secciones = Object.entries(porEmpresa).map(([empresa, personas]) => `
      <div style="margin-bottom:16px">
        <div style="font-size:13px;font-weight:bold;color:#92400e;margin-bottom:6px">${empresa} — ${personas.length} pendiente${personas.length>1?'s':''}</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#1e2433">
            <th style="padding:6px 10px;color:#fff;text-align:left">Nombre</th>
            <th style="padding:6px 10px;color:#fff;text-align:left">DNI</th>
            <th style="padding:6px 10px;color:#fff;text-align:center">Ingreso</th>
          </tr></thead>
          <tbody>${personas.map((p,i)=>`
            <tr style="background:${i%2===0?'#fffbf0':'#fff'}">
              <td style="padding:6px 10px">${p.nombre}</td>
              <td style="padding:6px 10px;font-family:monospace">${p.dni}</td>
              <td style="padding:6px 10px;text-align:center">${p.ingreso?.split(' ').slice(-1)[0]||'—'}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`).join('')

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto">
        <div style="background:#1e2433;padding:18px 24px;border-radius:8px 8px 0 0">
          <div style="font-size:16px;font-weight:bold;color:#fff">⚠️ Salidas pendientes · ${turnoLabel}</div>
          <div style="font-size:11px;color:#9aa3b8;margin-top:3px">Control de Ingreso · Home Delivery · ${fechaStr}</div>
        </div>
        <div style="background:#fff8f0;padding:20px 24px;border-radius:0 0 8px 8px;border:1px solid #fde68a;border-top:none">
          <p style="color:#1e2433;font-size:14px;margin:0 0 16px">
            Hay <strong>${pendientes.length} persona${pendientes.length>1?'s':''} sin salida registrada</strong>. 
            Tienes <strong>10 minutos</strong> para regularizar antes del reporte final.
          </p>
          ${secciones}
          <p style="color:#92400e;font-size:12px;margin:16px 0 0">Entra al panel y registra las salidas pendientes antes de las 10:30pm.</p>
        </div>
      </div>`

    await transporter.sendMail({
      from: `"Control HD" <${GMAIL}>`,
      to: correosHD.join(', '),
      subject: `⚠️ Pendientes sin salida · ${turnoLabel} · ${fechaStr}`,
      html
    })

    return res.status(200).json({ ok: true, enviado: true, pendientes: pendientes.length })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}
