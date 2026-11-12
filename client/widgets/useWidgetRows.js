import { useEffect, useState } from 'react'

// Reads rows through the Studio data engine (widgetApi.getData), so the page's filters and cross filters apply.
// `keys` are data mapping keys of the widget. Each returned row is keyed by those names.
export function useWidgetRows(params, keys) {
  const [state, setState] = useState({ rows: null, error: '' })
  useEffect(() => {
    let live = true
    const mapping = params?.dataMapping || {}
    const fields = keys.flatMap((k) => mapping[k] || [])
    if (!params?.widgetApi || fields.length < keys.length) {
      setState({ rows: null, error: 'Map every field in the Data panel to show this widget.' })
      return undefined
    }
    const take = (response) => {
      if (!live || response.replaced) return
      const rows = (response.results?.rows || []).map((row) => Object.fromEntries(keys.map((k) => [k, row[mapping[k][0].key]])))
      setState({ rows, error: '' })
    }
    params.widgetApi.getData({ fields }, { onDataUpdated: take }).then(take).catch((err) => live && setState({ rows: null, error: err.message }))
    return () => { live = false }
  }, [params, keys.join('|')])
  return state
}
