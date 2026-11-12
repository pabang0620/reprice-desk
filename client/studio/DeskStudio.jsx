import { useEffect, useMemo, useRef, useState } from 'react'
import { AgStudio, AgStudioProvider } from 'ag-studio-react'
import { AgStudioAiModule, enableStudioDevValidations } from 'ag-studio'
import { useDesk } from '../deskStore.js'
import { createRepriceHarness } from './agent.js'
import { darkTheme, lightTheme } from './theme.js'
import { compareState, executionState, loadSavedView, saveView } from './views.js'
import { buildSources } from './sources.js'
import { widgetsConfig } from './widgets.js'
import { aiToolDisplay } from './toolDisplay.jsx'

if (import.meta.env.DEV) enableStudioDevValidations()


export default function DeskStudio() {
  const { view, config, lastRunAt } = useDesk()
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
    const h = harness.current
    if (h) h.threads.forEach((t) => { h.deleteThread(t.id).catch(() => {}) })
  }, [view.sessionId])

  return (
    <div className={dark ? 'rd-studio-wrap' : 'rd-studio-wrap rd-light'}>
      <div className="rd-toolbar">
        <span className="rd-toolbar-label">View</span>
        <button className={current === 'compare' ? 'rd-tab rd-tab-on' : 'rd-tab'} onClick={() => open('compare')}>Compare</button>
        <button className={current === 'execution' ? 'rd-tab rd-tab-on' : 'rd-tab'} onClick={() => open('execution')}>Execution</button>
        <button className="rd-tab" onClick={() => saveView(current, studio.current.getState())}>Save layout as {current}</button>
        <button className="rd-tab" onClick={() => setDark(!dark)}>{dark ? 'Light' : 'Dark'} theme</button>
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
