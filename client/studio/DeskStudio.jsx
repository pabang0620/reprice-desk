import { useEffect, useMemo, useRef, useState } from 'react'
import { AgStudio, AgStudioProvider } from 'ag-studio-react'
import { AgStudioAiModule, enableStudioDevValidations } from 'ag-studio'
import { useDesk } from '../deskStore.js'
import { createRepriceHarness } from './agent.js'
import { darkTheme, lightTheme } from './theme.js'
import { clearThreads } from './threads.js'
import { compareState, executionState, loadSavedView, saveView } from './views.js'
import { buildSources } from './sources.js'
import { widgetsConfig } from './widgets.js'
import { aiToolDisplay } from './toolDisplay.jsx'

if (import.meta.env.DEV) enableStudioDevValidations()

// The 4-step path in the toolbar, read from the desk state, so a first-time user always sees the next click.
function StepPath({ view, card }) {
  const steps = [
    ['Who to keep', Boolean(view.rule)],
    ['Compare A and B', Boolean(card || view.execution)],
    ['Approve & run', Boolean(view.execution)],
    ['Read back from PayPal', Boolean(view.execution?.ok)],
  ]
  const current = steps.findIndex(([, done]) => !done)
  return (
    <ol className="rd-steps" aria-label="Path">
      {steps.map(([label, done], i) => (
        <li key={label} className={done ? 'is-done' : i === current ? 'is-current' : ''} aria-current={i === current ? 'step' : undefined}>
          <span className="rd-step-n">{done ? '✓' : i + 1}</span>{label}
        </li>
      ))}
    </ol>
  )
}

export default function DeskStudio() {
  const { view, config, lastRunAt, card } = useDesk()
  const studio = useRef(null)
  const [dark, setDark] = useState(true)
  const [current, setCurrent] = useState('compare')
  const data = useMemo(() => ({ sources: buildSources(view.studio) }), [view.studio])
  const harness = useRef(null)
  const ai = useMemo(() => ({ api }) => {
    harness.current = createRepriceHarness(api)
    return harness.current
  }, [])

  const open = (name) => {
    const saved = loadSavedView(name)
    studio.current?.setState(saved || (name === 'compare' ? compareState() : executionState()))
    setCurrent(name)
  }

  useEffect(() => { if (lastRunAt) open('execution') }, [lastRunAt])
  // A new bundle starts at the Compare view, even if the last one ended on Execution.
  const sessionKey = useRef(view.sessionId)
  useEffect(() => {
    if (sessionKey.current === view.sessionId) return
    sessionKey.current = view.sessionId
    open('compare')
    // A new bundle starts a new conversation, so the chat never talks about the previous bundle.
    clearThreads(harness.current)
  }, [view.sessionId])

  return (
    <div className={dark ? 'rd-studio-wrap' : 'rd-studio-wrap rd-light'}>
      <div className="rd-toolbar">
        <span className="rd-toolbar-label">View</span>
        <button className={current === 'compare' ? 'rd-tab rd-tab-on' : 'rd-tab'} onClick={() => open('compare')}>Compare</button>
        <button className={current === 'execution' ? 'rd-tab rd-tab-on' : 'rd-tab'} onClick={() => open('execution')}>Execution</button>
        <button className="rd-tab rd-tab-ghost" onClick={() => saveView(current, studio.current.getState())}>Save layout as {current}</button>
        <button className="rd-tab rd-tab-ghost" onClick={() => setDark(!dark)}>{dark ? 'Light' : 'Dark'} theme</button>
        <StepPath view={view} card={card} />
      </div>
      <div className="rd-studio">
        <AgStudioProvider licenseKey={config?.studioLicenseKey || undefined} modules={[AgStudioAiModule]}>
          <AgStudio
            mode="edit"
            data={data}
            widgets={widgetsConfig}
            theme={dark ? darkTheme : lightTheme}
            ai={ai}
            aiToolDisplay={aiToolDisplay}
            initialState={loadSavedView('compare') || compareState()}
            onApiReady={(event) => { studio.current = event.api }}
            style={{ height: '100%', width: '100%' }}
          />
        </AgStudioProvider>
      </div>
    </div>
  )
}
