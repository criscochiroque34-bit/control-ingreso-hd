import { transporter, GMAIL, GMAIL_PASS_CONFIGURADA } from './_helpers.js'

// Diagnóstico de correo: ?modo=verificar (solo prueba login) | ?modo=enviar&to=correo@x.com (envía un correo de prueba)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const q = { ...(req.query || {}), ...(typeof req.body === 'object' && req.body ? req.body : {}) }
  const modo = q.modo === 'enviar' ? 'enviar' : 'verificar'

  if (!GMAIL_PASS_CONFIGURADA) {
    return res.status(200).json({
      ok: false, paso: 'configuracion',
      error: 'La variable GMAIL_PASS no está configurada en Vercel (o no tiene 16 caracteres).',
      ayuda: 'Vercel → Settings → Environment Variables → crear GMAIL_PASS con la contraseña de aplicación de 16 caracteres → Redeploy.'
    })
  }
  try {
    await transporter.verify()
  } catch (e) {
    const auth = e.code === 'EAUTH' || /535|BadCredentials/i.test(e.message)
    return res.status(200).json({
      ok: false, paso: 'login', cuenta: GMAIL, error: e.message,
      ayuda: auth
        ? 'Gmail rechazó la contraseña. Genera una NUEVA contraseña de aplicación (con la verificación en 2 pasos activa) en la cuenta ' + GMAIL + ', actualiza GMAIL_PASS en Vercel y haz Redeploy.'
        : 'Error de conexión con Gmail. Reintenta en unos minutos.'
    })
  }
  if (modo === 'verificar') return res.status(200).json({ ok: true, paso: 'login', cuenta: GMAIL, mensaje: 'Conexión con Gmail correcta' })

  const to = String(q.to || '').trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(200).json({ ok: false, paso: 'destino', error: 'Correo de destino inválido' })
  try {
    await transporter.sendMail({
      from: `"Control HD" <${GMAIL}>`, to,
      subject: '✅ Prueba de correo · Control HD',
      html: '<div style="font-family:Arial,sans-serif"><h3>Prueba exitosa</h3><p>El envío automático de correos de Control HD funciona correctamente.</p></div>'
    })
    return res.status(200).json({ ok: true, paso: 'envio', cuenta: GMAIL, mensaje: 'Correo de prueba enviado a ' + to })
  } catch (e) {
    return res.status(200).json({ ok: false, paso: 'envio', error: e.message })
  }
}
