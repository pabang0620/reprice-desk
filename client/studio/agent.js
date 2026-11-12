import { createAiHarness, directLlmRunner } from 'ag-studio'
import { api } from '../api.js'
import { actions, deskStore } from '../deskStore.js'
import { claudeProxyAdapter } from './claudeAdapter.js'

const INSTRUCTIONS = `You are the Reprice Agent inside the Reprice Desk dashboard. You help a small business that bills members through PayPal Subscriptions raise prices for exactly the members the operator chooses.

Rules you must follow:
- You never move money and you never set a price. Prices come only from the operator's input boxes. If the operator tells you a price, say they must type it in the approval card.
- Every number you state must come from a tool result. Never invent counts, dates, prices, or percentages.
- Start with scan_subscribers. "Founders" can be read three ways (tag, signup month, launch campaign). State how many subscribers the readings disagree on, with their labels, and ask which reading to use. Save the operator's answer with propose_cohort_rules. It is only a draft: the operator confirms it in the desk.
- After the operator confirms, call compare_strategies and explain the recommendation using only its rows. Strategy A raises the plan and protects kept members with overrides first. Strategy B creates a new plan for new signups and raises only chosen members one by one. If the operator cannot change their checkout button, A is the answer.
- If a result says an email count is pending, say it is not verified yet.
- For notice wording use draft_notice with no dollar amounts that the tools did not return.
- To build or change dashboard widgets (for example "show kept members by signup month"), delegate to the built-in data and widget agents.
Keep answers short and concrete.`

const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const ruleEnum = { type: 'string', enum: ['tag', 'signup', 'source'] }

const TOOL_DEFS = [
  { name: 'scan_subscribers', description: 'Read every subscriber in the bundle and count where the three founder definitions disagree.', parameters: object() },
  { name: 'propose_cohort_rules', description: 'Save a draft of the founder definitions you found. The operator confirms it in the desk. Draft only.', parameters: object({ rules: { type: 'array', items: object({ id: ruleEnum, reason: { type: 'string' } }, ['id']) }, selected: ruleEnum }, ['rules']) },
  { name: 'compare_strategies', description: 'Return the eight code-computed metrics for strategy A and B. Prices come from the operator, any drafted price is ignored.', parameters: object({ plan_draft: object({ monthly: { type: 'number' }, annual: { type: 'number' }, note: { type: 'string' } }), preference: { type: 'string', enum: ['no_checkout_change', 'no_emails_to_kept', 'none'] } }) },
  { name: 'get_schedule_preview', description: 'Show scheduled raises, ten-day shifts and members outside the notice window.', parameters: object({ strategy: { type: 'string', enum: ['A', 'B'] } }) },
  { name: 'draft_notice', description: 'Save a member notice draft. Amounts not computed by the code are rejected.', parameters: object({ cohort: { type: 'string', enum: ['raise', 'keep'] }, body: { type: 'string' } }, ['cohort', 'body']) },
  { name: 'get_execution_report', description: 'Report what the last run did and what PayPal returned when read back.', parameters: object() },
]

function makeTool(def) {
  return {
    name: def.name,
    description: def.description,
    kind: 'client',
    schema: () => ({ name: def.name, description: def.description, parameters: def.parameters, kind: 'client' }),
    async execute(call, ctx) {
      const { sessionId } = deskStore.get()
      if (!sessionId) return ctx.error('Open a bundle first.')
      try {
        const data = await api.post(`/api/session/${sessionId}/agent/${def.name}`, call.args)
        await actions.refresh()
        return ctx.success(JSON.stringify(data), data)
      } catch (err) {
        return ctx.error(err.message)
      }
    },
  }
}

export const PROMPT_STARTERS = [
  { label: 'Keep founders', prompt: 'Keep founders at $9, raise regular monthly to $12 and annual to $120.' },
  { label: 'Which strategy?', prompt: 'Founders must not get any email from PayPal. Which strategy do you recommend?' },
  { label: 'Add a widget', prompt: 'Show kept members by signup month.' },
]

// The label says which model really answers: the stand-in, the hosted API, or the developer's local Claude account.
function modelLabel() {
  const llm = deskStore.get().config?.modes.llm
  if (llm === 'account') return 'Claude Sonnet (local account)'
  if (llm === 'live') return 'Claude Sonnet (server API key)'
  return 'Claude stand-in (scripted, no model)'
}

// Studio harness: our Claude agent is primary, and the built-in data and widget agents stay available to it.
export function createRepriceHarness(api_) {
  return createAiHarness(api_, ({ tools, builtIn }) => {
    const adapter = claudeProxyAdapter
    const reprice = directLlmRunner({
      id: 'reprice',
      name: 'Reprice Agent',
      description: 'Finds who the founders are, compares the two ways to raise prices, and explains the pick.',
      adapter,
      instructions: () => INSTRUCTIONS,
      tools: (ctx) => [...TOOL_DEFS.map(makeTool), ctx.tools.delegateTo(['data', 'widget'])],
    })
    const wrap = (id) => directLlmRunner({ ...builtIn[id], adapter })
    return {
      agents: [reprice, wrap('lead'), wrap('data'), wrap('page'), wrap('planning'), wrap('widget')],
      primary: 'reprice',
      promptStarters: PROMPT_STARTERS,
      models: [{ id: 'claude', label: modelLabel() }],
    }
  })
}
