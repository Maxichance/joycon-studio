// JOYCON_DEV_ONLY : outil de vérification, jamais inclus dans le build livré.
// Usage : node tools/cdp.mjs shot <fichier.png> | eval "<js>" | click "<sélecteur>" | text "<sélecteur>"
// L'app doit tourner avec WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222.
import fs from 'node:fs'

const port = Number(process.env.CDP_PORT ?? 9222)
const [cmd, ...args] = process.argv.slice(2)

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
if (!page) throw new Error('aucune page CDP')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('CDP refusé'))
})

let id = 0
const pending = new Map()
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
}
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'exception')
  return r.result?.result?.value
}

if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(args[0], Buffer.from(r.result.data, 'base64'))
  console.log('ok', args[0])
} else if (cmd === 'eval') {
  console.log(JSON.stringify(await evaluate(args[0])))
} else if (cmd === 'click') {
  console.log(await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(args[0])}); if (!e) return 'introuvable'; e.click(); return 'ok' })()`))
} else if (cmd === 'text') {
  console.log(await evaluate(`document.querySelector(${JSON.stringify(args[0])})?.innerText ?? 'introuvable'`))
} else {
  console.log('commande inconnue')
}
ws.close()
