import { db, transporter, GMAIL, fechaLabel, calcTiempoTrabajado, esTurnoNoche, getCorreosHD, getCorreosEmpresas, getEventosFecha, calcBreakMinLocal, calcBanioLocal, tablaPersonal } from './_helpers.js'

// Turno Día: ingreso entre 6am y 8:59pm del mismo día
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
    const turnoLabel = 'Turno Día'

    const [empresasCorreos, correosHD] = await Promise.all([
      getCorreosEmpresas(),
      getCorreosHD()
    ])

    const { data: registros } = await db.from('estado_hoy').select('*').eq('fecha', fecha)
    const registrosDia = (registros||[]).filter(r => !esTurnoNoche(r.ingreso))
    const todosEventos = await getEventosFecha(fecha)

    const empresas = [...new Set(empresasCorreos.map(e => e.empresa))]
    const resultados = []
    const resumenHD = []

    // Incluir todas las empresas con registros aunque no estén en empresas_correos
    const todasEmpresas = [...new Set([
      ...empresas,
      ...registrosDia.map(r => r.empresa).filter(Boolean)
    ])]

    for (const empresa of todasEmpresas) {
      const correosDest = empresasCorreos.filter(e => e.empresa === empresa)
      const personal = registrosDia.filter(r => r.empresa === empresa)
      if (!personal.length) { resultados.push({ empresa, enviado: false, razon: 'Sin registros' }); continue }

      const sinSalida = personal.filter(p => !p.salida || p.estado !== 'salida')
      const conSalida = personal.filter(p => p.salida).length
      const nombreContacto = correosDest[0]?.nombre_contacto || empresa

      // Calcular break, baño y tiempo trabajado por persona
      for (const p of personal) {
        const breakMin = calcBreakMinLocal(p.dni, todosEventos)
        const { veces: banioVeces, mins: banioMin } = calcBanioLocal(p.dni, todosEventos)
        const trabajadoMin = calcTiempoTrabajado(p.ingreso, p.salida, breakMin)
        p._breakStr = breakMin > 0 ? `${breakMin} min` : '—'
        p._banioStr = banioVeces > 0 ? `${banioVeces}v/${banioMin}min` : '—'
        p._trabajadoMin = trabajadoMin
      }

      resumenHD.push({ empresa, total: personal.length, conSalida, sinSalida: sinSalida.length, personal })

      if (sinSalida.length > 0) {
        resultados.push({ empresa, enviado: false, razon: `${sinSalida.length} pendientes` })
        continue
      }

      // Si la empresa no tiene correos configurados, no se le envía pero queda en resumenHD
      if (!correosDest.length) {
        resultados.push({ empresa, enviado: false, razon: 'Sin correos configurados' })
        continue
      }

      // Reporte completo a la empresa
      const html = htmlReporte(empresa, fechaStr, turnoLabel, nombreContacto, personal, conSalida)
      const destinatarios = correosDest.map(c => c.correo).join(', ')
      await transporter.sendMail({
        from: `"Control HD" <${GMAIL}>`,
        to: destinatarios,
        subject: `Reporte de asistencia · ${empresa} · ${fechaStr} · ${turnoLabel}`,
        html
      })
      resultados.push({ empresa, enviado: true, destinatarios })
    }

    // Correo resumen para equipo HD
    if (correosHD.length && resumenHD.length) {
      const htmlHD = htmlResumenHD(fechaStr, turnoLabel, resumenHD)
      await transporter.sendMail({
        from: `"Control HD" <${GMAIL}>`,
        to: correosHD.join(', '),
        subject: `Reporte completo · ${turnoLabel} · ${fechaStr}`,
        html: htmlHD
      })
    }

    return res.status(200).json({ 
      ok: true, 
      resultados,
      debug: {
        fecha,
        totalRegistros: registros?.length || 0,
        registrosDia: registrosDia.length,
        resumenHD: resumenHD.map(r => ({ empresa: r.empresa, total: r.total, sinSalida: r.sinSalida })),
        correosHD: correosHD.length,
        registrosPorEmpresa: Object.fromEntries(
          [...new Set((registros||[]).map(r=>r.empresa))].map(emp => [
            emp, {
              total: (registros||[]).filter(r=>r.empresa===emp).length,
              dia: registrosDia.filter(r=>r.empresa===emp).length
            }
          ])
        )
      }
    })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}

function htmlReporte(empresa, fechaStr, turnoLabel, contacto, personal, conSalida) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
      <div style="background:#1e2433;padding:18px 24px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:16px;font-weight:bold;color:#fff">Reporte de Asistencia · ${empresa}</div>
          <div style="font-size:11px;color:#9aa3b8;margin-top:3px">Control de Ingreso · Home Delivery · ${fechaStr}</div>
        </div>
        <div style="background:#e85d9b;color:#fff;font-size:11px;font-weight:bold;padding:4px 12px;border-radius:12px">${turnoLabel}</div>
      </div>
      <div style="background:#f7f9fc;padding:20px 24px;border-radius:0 0 8px 8px;border:1px solid #dde2ed;border-top:none">
        <p style="color:#1e2433;font-size:14px;margin:0 0 16px">Hola <strong>${contacto}</strong>, reporte del ${fechaStr}.</p>
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
            <div style="font-size:22px;font-weight:bold;color:#e85d9b">${personal.length - conSalida}</div>
            <div style="font-size:10px;color:#7a8299;text-transform:uppercase">Sin salida</div>
          </div>
        </div>
        <div style="background:#fff;border:1px solid #dde2ed;border-radius:8px;overflow:hidden">
          ${tablaPersonal(personal)}
        </div>
        <p style="color:#7a8299;font-size:11px;margin:16px 0 0">Generado automáticamente · Control de Ingreso HD · ${fechaStr}</p>
      </div>
    </div>`
}

function htmlResumenHD(fechaStr, turnoLabel, resumen) {
  const secciones = resumen.map(({ empresa, total, conSalida, sinSalida, personal }) => `
    <div style="margin-bottom:24px">
      <div style="font-size:13px;font-weight:bold;color:#1e2433;margin-bottom:8px;padding-bottom:4px;border-bottom:2px solid #dde2ed">
        ${empresa} — ${total} personas · ${conSalida} completas${sinSalida > 0 ? ` · <span style="color:#dc2626">${sinSalida} sin salida</span>` : ''}
      </div>
      <div style="background:#fff;border:1px solid #dde2ed;border-radius:8px;overflow:hidden">
        ${tablaPersonal(personal)}
      </div>
    </div>`).join('')

  return `
    <div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto">
      <div style="background:#1e2433;padding:18px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:16px;font-weight:bold;color:#fff">Reporte completo · ${turnoLabel}</div>
        <div style="font-size:11px;color:#9aa3b8;margin-top:3px">Control de Ingreso · Home Delivery · ${fechaStr}</div>
      </div>
      <div style="background:#f7f9fc;padding:20px 24px;border-radius:0 0 8px 8px;border:1px solid #dde2ed;border-top:none">
        ${secciones}
        <p style="color:#7a8299;font-size:11px;margin:16px 0 0">Generado automáticamente · Control de Ingreso HD</p>
      </div>
    </div>`
}
