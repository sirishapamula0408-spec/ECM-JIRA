/*
 * JL-126 — the seven standard templates Confluence Lite ships with.
 *
 * ── Why the bodies are HTML ─────────────────────────────────────────────────
 *
 * Pages store sanitised HTML (JL-76), and a template is a starting page body,
 * so it is the same format. Every tag used below is on sanitizeHtml's
 * allow-list — h2, h3, p, ul, ol, li, table, thead, tbody, tr, th, td, em,
 * strong, hr — which means a template survives the sanitiser unchanged. A
 * template written with a tag the sanitiser drops would silently lose
 * structure the first time someone used it.
 *
 * ── Why they are prompts, not prose ─────────────────────────────────────────
 *
 * Each section is a heading plus a one-line italic prompt saying what belongs
 * there. A template full of lorem or of plausible-looking fake content gets
 * shipped as if it were real the first time someone forgets to overwrite it;
 * a prompt cannot be mistaken for the answer.
 */

/** A section: heading, and the question it is asking the author. */
const section = (heading, prompt) =>
  `<h2>${heading}</h2><p><em>${prompt}</em></p>`

const bullets = (heading, prompt, count = 3) =>
  `<h2>${heading}</h2><p><em>${prompt}</em></p><ul>${'<li></li>'.repeat(count)}</ul>`

const table = (heading, prompt, columns) =>
  `<h2>${heading}</h2><p><em>${prompt}</em></p>`
  + '<table><thead><tr>'
  + columns.map((c) => `<th>${c}</th>`).join('')
  + '</tr></thead><tbody><tr>'
  + columns.map(() => '<td></td>').join('')
  + '</tr></tbody></table>'

export const BUILTIN_TEMPLATES = [
  {
    key: 'sop',
    name: 'Standard Operating Procedure',
    description: 'A repeatable procedure with scope, steps and an owner.',
    body: [
      section('Purpose', 'What this procedure achieves, in one or two sentences.'),
      section('Scope', 'Who and what this applies to — and explicitly what it does not.'),
      table('Roles and responsibilities', 'Who does what.', ['Role', 'Responsibility']),
      bullets('Prerequisites', 'What must be true before starting.'),
      '<h2>Procedure</h2><p><em>Numbered steps. One action per step.</em></p><ol><li></li><li></li><li></li></ol>',
      bullets('Exceptions and escalation', 'When this procedure does not apply, and who to ask.', 2),
      table('Review', 'Who owns this and when it was last checked.', ['Owner', 'Last reviewed', 'Next review']),
    ].join(''),
  },
  {
    key: 'meeting-notes',
    name: 'Meeting Notes',
    description: 'Attendees, decisions and actions from a meeting.',
    body: [
      table('Details', 'When, and who was there.', ['Date', 'Attendees', 'Chair']),
      bullets('Agenda', 'What the meeting set out to cover.'),
      section('Discussion', 'The substance. Keep it to what a person who missed it needs.'),
      bullets('Decisions', 'What was actually decided — not what was discussed.', 2),
      table('Actions', 'Each action needs an owner and a date, or it is not an action.', ['Action', 'Owner', 'Due']),
    ].join(''),
  },
  {
    key: 'knowledge-article',
    name: 'Knowledge Article',
    description: 'A reference explainer for something the team needs to know.',
    body: [
      section('Summary', 'The short answer, for someone who reads nothing else.'),
      section('Context', 'Why this exists and when it matters.'),
      section('Detail', 'The full explanation.'),
      bullets('Common questions', 'What people ask about this.'),
      bullets('Related', 'Pages, issues or systems this connects to.', 2),
    ].join(''),
  },
  {
    key: 'problem-resolution',
    name: 'Problem Resolution',
    description: 'A problem, what caused it, and what was done about it.',
    body: [
      section('Problem', 'What was observed, and by whom. Symptoms, not diagnosis.'),
      table('Impact', 'Who and what was affected, and for how long.', ['Affected', 'Severity', 'Duration']),
      section('Investigation', 'What was checked, and what it ruled in or out.'),
      section('Root cause', 'The actual cause — not the trigger, and not the first plausible story.'),
      section('Resolution', 'What was changed to fix it.'),
      table('Follow-up', 'What stops this happening again.', ['Action', 'Owner', 'Due']),
    ].join(''),
  },
  {
    key: 'deployment-procedure',
    name: 'Deployment Procedure',
    description: 'How a release goes out, and how it comes back.',
    body: [
      section('What is being deployed', 'The component and the version.'),
      bullets('Pre-deployment checks', 'What must be verified before starting.'),
      '<h2>Deployment steps</h2><p><em>Numbered, in order, one action per step.</em></p><ol><li></li><li></li><li></li></ol>',
      bullets('Verification', 'How to tell it worked — not "the deploy finished".'),
      '<h2>Rollback</h2><p><em>The exact steps to undo this, written before they are needed.</em></p><ol><li></li><li></li></ol>',
      table('Sign-off', 'Who ran it and who confirmed it.', ['Deployed by', 'Verified by', 'Date']),
    ].join(''),
  },
  {
    key: 'technical-documentation',
    name: 'Technical Documentation',
    description: 'How a component works, for whoever maintains it next.',
    body: [
      section('Overview', 'What this component does, in one paragraph.'),
      section('Architecture', 'How it is put together, and why that way.'),
      table('Interfaces', 'What it talks to, and in which direction.', ['Interface', 'Direction', 'Notes']),
      table('Configuration', 'Settings that change behaviour.', ['Setting', 'Default', 'Effect']),
      bullets('Operational notes', 'What an on-call person needs at 3am.'),
      bullets('Known limitations', 'What it deliberately does not do.', 2),
    ].join(''),
  },
  {
    key: 'decision-record',
    name: 'Decision Record',
    description: 'A decision, the options weighed, and why this one.',
    body: [
      table('Status', 'Where this decision stands.', ['Status', 'Date', 'Deciders']),
      section('Context', 'The situation forcing a decision. What makes doing nothing unattractive.'),
      section('Decision', 'What was decided, stated plainly and in the active voice.'),
      table('Options considered', 'Including the one chosen, so the comparison is visible.', ['Option', 'Pros', 'Cons']),
      section('Consequences', 'What becomes easier, and what becomes harder. Both.'),
    ].join(''),
  },
]

export default BUILTIN_TEMPLATES
