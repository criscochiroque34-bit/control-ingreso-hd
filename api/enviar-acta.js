import { db, transporter, GMAIL, fechaLabel, esTurnoNoche, getCorreosEmpresas, getEventosFecha, calcBreakMinLocal, calcBanioLocal, calcTiempoTrabajado, tablaPersonal, getSolicitud, bannerCumplimiento } from './_helpers.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { empresa, fecha, turno, empresasDestino, supervisor } = req.body
    if (!empresa || !fecha || !turno || !empresasDestino?.length) {
      return res.status(400).json({ error: 'Faltan parámetros' })
    }

    const turnoLabel = turno === 'dia' ? 'Turno Día' : 'Turno Noche'
    const fechaStr = fechaLabel(fecha)
    const empresasCorreos = await getCorreosEmpresas()
    const todosEventos = await getEventosFecha(fecha)

    // Traer registros de la empresa y filtrar por turno
    const { data: registros } = await db.from('estado_hoy').select('*')
      .eq('empresa', empresa).eq('fecha', fecha)
    const personal = (registros||[]).filter(p => {
      const esTN = esTurnoNoche(p.ingreso)
      return turno === 'noche' ? esTN : !esTN
    })

    if (!personal.length) return res.status(200).json({ enviados: 0, razon: 'Sin registros' })

    // Calcular break/baño por persona
    for (const p of personal) {
      const breakMin = calcBreakMinLocal(p.dni, todosEventos)
      const { veces: banioVeces, mins: banioMin } = calcBanioLocal(p.dni, todosEventos)
      const trabajadoMin = calcTiempoTrabajado(p.ingreso, p.salida, breakMin)
      p._breakStr = breakMin > 0 ? `${breakMin} min` : '—'
      p._banioStr = banioVeces > 0 ? `${banioVeces}v/${banioMin}min` : '—'
      p._trabajadoMin = trabajadoMin
    }

    const conSalida = personal.filter(p=>p.salida).length
    const nombreSupervisor = supervisor?.nombre || 'Supervisor HD'
    const cargoSupervisor = supervisor?.cargo || 'Home Delivery'

    // Banner de cumplimiento si existe solicitud para esta empresa/fecha/turno
    const solicitado = await getSolicitud(fecha, turno, empresa)
    const asistieronUnicos = new Set(personal.map(p => p.dni)).size
    const banner = bannerCumplimiento(solicitado, asistieronUnicos)

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
        <div style="background:#1e2433;padding:18px 24px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:16px;font-weight:bold;color:#fff">Reporte de Asistencia · ${empresa}</div>
            <div style="font-size:11px;color:#9aa3b8;margin-top:3px">Control de Ingreso · Home Delivery · ${fechaStr}</div>
          </div>
          <div style="background:${turno==='noche'?'#8b5cf6':'#e85d9b'};color:#fff;font-size:11px;font-weight:bold;padding:4px 12px;border-radius:12px">${turnoLabel}</div>
        </div>
        <div style="background:#f7f9fc;padding:20px 24px;border-radius:0 0 8px 8px;border:1px solid #dde2ed;border-top:none">
          ${banner || ''}
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
          <div style="background:#fff;border:1px solid #dde2ed;border-radius:8px;overflow:hidden;margin-bottom:16px">
            ${tablaPersonal(personal)}
          </div>
          <div style="border-top:1px solid #dde2ed;padding-top:14px">
            <div style="font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.08em;color:#7a8299;margin-bottom:8px">Conformidad y firma</div>
            <div style="font-family:Georgia,serif;font-size:14px;font-weight:bold;color:#1e2433;border-bottom:2px solid #1e2433;padding-bottom:3px;display:inline-block">${nombreSupervisor}</div>
            <div style="font-size:11px;color:#7a8299;margin-top:4px">${cargoSupervisor}</div>
          </div>
          <p style="color:#7a8299;font-size:11px;margin:16px 0 0">Generado automáticamente · Control de Ingreso HD · ${fechaStr}</p>
        </div>
      </div>`

    // Enviar a cada empresa seleccionada
    let enviados = 0
    for (const empDest of empresasDestino) {
      const correosDest = empresasCorreos.filter(e => e.empresa === empDest)
      if (!correosDest.length) continue
      const nombreContacto = correosDest[0]?.nombre_contacto || empDest
      const destinatarios = correosDest.map(c=>c.correo).join(', ')
      const htmlConSaludo = html.replace(
        '<div style="display:flex;gap:10px',
        `<p style="color:#1e2433;font-size:14px;margin:0 0 16px">Hola <strong>${nombreContacto}</strong>, se adjunta el reporte del ${fechaStr}.</p><div style="display:flex;gap:10px`
      )
      await transporter.sendMail({
        from: `"Control HD" <${GMAIL}>`,
        to: destinatarios,
        subject: `Reporte de asistencia · ${empresa} · ${fechaStr} · ${turnoLabel}`,
        html: htmlConSaludo
      })
      enviados++
    }

    return res.status(200).json({ ok: true, enviados })
  } catch(e) {
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}
