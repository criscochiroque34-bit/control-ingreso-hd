import { db, transporter, GMAIL, fechaLabel, calcTiempoTrabajado, getTurno, getCorreosHD, getCorreosEmpresas, getEventosFecha, calcBreakMinLocal, calcBanioLocal, tablaPersonal, getSolicitud, bannerCumplimiento } from './_helpers.js'

// Reporte combinado Mañana + Día — se envía al cierre del turno día (10:30pm Lima)
// Mañana: 5am–10:59am · Día: 11am–8:59pm · Corte de jornada 5am
const hoy = () => {
  const lima = new Date(Date.now() - 5 * 60 * 60 * 1000)
  if (lima.getUTCHours() < 5) lima.setUTCDate(lima.getUTCDate() - 1)
  return lima.toISOString().slice(0, 10)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  try {
    const fecha = hoy()
    const fechaStr = fechaLabel(fecha)
    const turnoLabel = 'Turno Mañana y Día'

    const [empresasCorreos, correosHD] = await Promise.all([
      getCorreosEmpresas(),
      getCorreosHD()
    ])

    const { data: registros } = await db.from('estado_hoy').select('*').eq('fecha', fecha)
    const registrosManana = (registros||[]).filter(r => getTurno(r.ingreso) === 'manana')
    const registrosDia = (registros||[]).filter(r => getTurno(r.ingreso) === 'dia')
    const todosEventos = await getEventosFecha(fecha)

    const empresas = [...new Set(empresasCorreos.map(e => e.empresa))]
    const resultados = []
    const resumenHD = []

    // Incluir todas las empresas con registros aunque no estén en empresas_correos
    const todasEmpresas = [...new Set([
      ...empresas,
      ...registrosManana.map(r => r.empresa).filter(Boolean),
      ...registrosDia.map(r => r.empresa).filter(Boolean)
    ])]

    // Calcular stats de una lista de personal (muta cada persona con _breakStr/_banioStr/_trabajadoMin)
    const prepararPersonal = (personal) => {
      for (const p of personal) {
        const breakMin = calcBreakMinLocal(p.dni, todosEventos)
        const { veces: banioVeces, mins: banioMin } = calcBanioLocal(p.dni, todosEventos)
        const trabajadoMin = calcTiempoTrabajado(p.ingreso, p.salida, breakMin)
        p._breakStr = breakMin > 0 ? `${breakMin} min` : '—'
        p._banioStr = banioVeces > 0 ? `${banioVeces}v/${banioMin}min` : '—'
        p._trabajadoMin = trabajadoMin
      }
    }

    for (const empresa of todasEmpresas) {
      const correosDest = empresasCorreos.filter(e => e.empresa === empresa)
      const perManana = registrosManana.filter(r => r.empresa === empresa)
      const perDia = registrosDia.filter(r => r.empresa === empresa)

      if (!perManana.length && !perDia.length) {
        resultados.push({ empresa, enviado: false, razon: 'Sin registros' })
        continue
      }

      prepararPersonal(perManana)
      prepararPersonal(perDia)

      const sinSalidaM = perManana.filter(p => !p.salida || p.estado !== 'salida')
      const sinSalidaD = perDia.filter(p => !p.salida || p.estado !== 'salida')
      const nombreContacto = correosDest[0]?.nombre_contacto || empresa

      // Cumplimiento por turno (para resumen HD y para el correo)
      const [solM, solD] = await Promise.all([
        getSolicitud(fecha, 'manana', empresa),
        getSolicitud(fecha, 'dia', empresa)
      ])
      const uniM = new Set(perManana.map(p => p.dni)).size
      const uniD = new Set(perDia.map(p => p.dni)).size
      const pctM = solM !== null && solM > 0 ? Math.round(uniM / solM * 100) : null
      const pctD = solD !== null && solD > 0 ? Math.round(uniD / solD * 100) : null

      resumenHD.push({
        empresa,
        secciones: [
          perManana.length ? { turno: 'Mañana', personal: perManana, conSalida: perManana.filter(p=>p.salida).length, sinSalida: sinSalidaM.length, solicitado: solM, pct: pctM } : null,
          perDia.length ? { turno: 'Día', personal: perDia, conSalida: perDia.filter(p=>p.salida).length, sinSalida: sinSalidaD.length, solicitado: solD, pct: pctD } : null
        ].filter(Boolean)
      })

      // Solo los pendientes del turno DÍA bloquean el envío (tienen aviso 10:20pm y aún pueden corregirse).
      // Los de mañana (personal que salió 11am) no bloquean: aparecen como "sin salida" en su sección.
      if (sinSalidaD.length > 0) {
        resultados.push({ empresa, enviado: false, razon: `${sinSalidaD.length} pendientes turno día` })
        continue
      }

      if (!correosDest.length) {
        resultados.push({ empresa, enviado: false, razon: 'Sin correos configurados' })
        continue
      }

      // Armar secciones del correo (solo los turnos con personal)
      const secciones = []
      if (perManana.length) {
        secciones.push(seccionTurno('🌅 Turno Mañana', '#06b6d4', perManana, bannerCumplimiento(solM, uniM)))
      }
      if (perDia.length) {
        secciones.push(seccionTurno('☀️ Turno Día', '#e85d9b', perDia, bannerCumplimiento(solD, uniD)))
      }

      const html = htmlReporte(empresa, fechaStr, nombreContacto, secciones)
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
        registrosManana: registrosManana.length,
        registrosDia: registrosDia.length,
        resumenHD: resumenHD.map(r => ({ empresa: r.empresa, secciones: r.secciones.map(s => ({ turno: s.turno, total: s.personal.length, sinSalida: s.sinSalida })) })),
        correosHD: correosHD.length
      }
    })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}

// Sección de un turno dentro del correo: título + banner cumplimiento + mini stats + tabla
function seccionTurno(titulo, color, personal, banner) {
  const conSalida = personal.filter(p => p.salida).length
  return `
    <div style="margin-bottom:26px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid ${color}">
        <span style="font-size:14px;font-weight:bold;color:#1e2433">${titulo}</span>
        <span style="font-size:11px;color:#7a8299">· ${personal.length} persona${personal.length!==1?'s':''}</span>
      </div>
      ${banner || ''}
      <div style="display:flex;gap:10px;margin-bottom:14px">
        <div style="flex:1;background:#fff;border:1px solid #dde2ed;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:20px;font-weight:bold;color:#1e2433">${personal.length}</div>
          <div style="font-size:10px;color:#7a8299;text-transform:uppercase">Asistieron</div>
        </div>
        <div style="flex:1;background:#fff;border:1px solid #dde2ed;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:20px;font-weight:bold;color:#22c27a">${conSalida}</div>
          <div style="font-size:10px;color:#7a8299;text-transform:uppercase">Salida completa</div>
        </div>
        <div style="flex:1;background:#fff;border:1px solid #dde2ed;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:20px;font-weight:bold;color:#e85d9b">${personal.length - conSalida}</div>
          <div style="font-size:10px;color:#7a8299;text-transform:uppercase">Sin salida</div>
        </div>
      </div>
      <div style="background:#fff;border:1px solid #dde2ed;border-radius:8px;overflow:hidden">
        ${tablaPersonal(personal)}
      </div>
    </div>`
}

function htmlReporte(empresa, fechaStr, contacto, secciones) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
      <div style="background:#1e2433;padding:18px 24px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:16px;font-weight:bold;color:#fff">Reporte de Asistencia · ${empresa}</div>
          <div style="font-size:11px;color:#9aa3b8;margin-top:3px">Control de Ingreso · Home Delivery · ${fechaStr}</div>
        </div>
        <div style="background:#e85d9b;color:#fff;font-size:11px;font-weight:bold;padding:4px 12px;border-radius:12px">Mañana y Día</div>
      </div>
      <div style="background:#f7f9fc;padding:20px 24px;border-radius:0 0 8px 8px;border:1px solid #dde2ed;border-top:none">
        <p style="color:#1e2433;font-size:14px;margin:0 0 16px">Hola <strong>${contacto}</strong>, reporte del ${fechaStr}.</p>
        ${secciones.join('')}
        <p style="color:#7a8299;font-size:11px;margin:16px 0 0">Generado automáticamente · Control de Ingreso HD · ${fechaStr}</p>
      </div>
    </div>`
}

function htmlResumenHD(fechaStr, turnoLabel, resumen) {
  const bloques = resumen.map(({ empresa, secciones }) => {
    return secciones.map(({ turno, personal, conSalida, sinSalida, solicitado, pct }) => {
      let cumplLine = ''
      if (solicitado !== null && solicitado !== undefined) {
        const col = pct > 100 ? '#c2410c' : pct >= 90 ? '#065f46' : pct >= 85 ? '#854d0e' : '#991b1b'
        cumplLine = ` · Solicitado: <strong>${solicitado}</strong> · Cumplimiento: <strong style="color:${col}">${pct}%</strong>`
      }
      return `
      <div style="margin-bottom:24px">
        <div style="font-size:13px;font-weight:bold;color:#1e2433;margin-bottom:8px;padding-bottom:4px;border-bottom:2px solid #dde2ed">
          ${empresa} · ${turno} — ${personal.length} personas · ${conSalida} completas${sinSalida > 0 ? ` · <span style="color:#dc2626">${sinSalida} sin salida</span>` : ''}${cumplLine}
        </div>
        <div style="background:#fff;border:1px solid #dde2ed;border-radius:8px;overflow:hidden">
          ${tablaPersonal(personal)}
        </div>
      </div>`
    }).join('')
  }).join('')

  return `
    <div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto">
      <div style="background:#1e2433;padding:18px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:16px;font-weight:bold;color:#fff">Reporte completo · ${turnoLabel}</div>
        <div style="font-size:11px;color:#9aa3b8;margin-top:3px">Todas las empresas · ${fechaStr}</div>
      </div>
      <div style="background:#f7f9fc;padding:20px 24px;border-radius:0 0 8px 8px;border:1px solid #dde2ed;border-top:none">
        ${bloques}
        <p style="color:#7a8299;font-size:11px;margin:16px 0 0">Generado automáticamente · Control de Ingreso HD</p>
      </div>
    </div>`
}
