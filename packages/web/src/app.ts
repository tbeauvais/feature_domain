// A published app's page (app.html), served by the Worker on <slug>.<app domain> for every page path. For now it only
// names the app it reads from /api/v1/app; rendering the app comes with its own reader.

const main = document.getElementById('app')!

function say(text: string, heading = false) {
  const element = document.createElement(heading ? 'h1' : 'p')
  element.textContent = text
  main.replaceChildren(element)
}

async function show() {
  try {
    const response = await fetch('/api/v1/app', { headers: { Accept: 'application/json' }, redirect: 'manual' })
    if (response.status === 404) return say('Nothing is published at this address.')
    if (!response.ok) return say("The app couldn't be loaded. Try again in a moment.")
    const model = (await response.json()) as { name?: unknown }
    const name = typeof model.name === 'string' && model.name.trim() !== '' ? model.name : 'App'
    document.title = name
    say(name, true)
  } catch {
    say("The app couldn't be loaded. Try again in a moment.")
  }
}

void show()
