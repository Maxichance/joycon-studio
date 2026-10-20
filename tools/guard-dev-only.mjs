// JOYCON_DEV_ONLY : vérifie que l'outillage de développement n'est pas dans le build livré.
// À lancer après `npm run build`.
import fs from 'node:fs'
import path from 'node:path'

const MARKER = ['JOYCON', 'DEV', 'ONLY'].join('_')

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? files(p) : [p]
  })
}

if (!fs.existsSync('dist')) {
  console.error('dist/ absent : lancez npm run build avant le garde.')
  process.exit(1)
}

const leaks = files('dist').filter((f) => fs.readFileSync(f, 'utf8').includes(MARKER))
const dev = files('tools').filter((f) => fs.readFileSync(f, 'utf8').includes(MARKER))
if (dev.length === 0) {
  console.error('Aucun outil marqué : le garde ne vérifie rien.')
  process.exit(1)
}
if (leaks.length > 0) {
  console.error('Outillage de développement présent dans dist :', leaks)
  process.exit(1)
}
console.log(`ok : ${dev.length} fichier(s) d'outillage, aucun dans dist.`)
