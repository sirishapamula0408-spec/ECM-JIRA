/*
 * JL-187 (fosasoft) — starter content for the quick-insert panel.
 *
 * Built in, rather than rows in wiki_templates, because the quick-insert
 * buttons name these three and must always find them. The "All templates"
 * dialog lists these AND the workspace's own templates from
 * GET /api/wiki-templates.
 *
 * Plain HTML in the shape the editor itself writes, so it passes sanitizeHtml
 * unchanged.
 */
export const BUILT_IN_TEMPLATES = [
  {
    key: 'troubleshooting',
    name: 'Troubleshooting article',
    description: 'Describe a problem, its cause and the fix.',
    body:
      '<div data-type="panel" data-panel-type="info"><p>Use this article to help people solve a problem on their own.</p></div>' +
      '<h2>Problem</h2><p>Describe what people see: the error message, the symptom, and where it happens.</p>' +
      '<h2>Cause</h2><p>Explain why it happens.</p>' +
      '<h2>Solution</h2><ol><li><p>First step to fix it.</p></li><li><p>Second step.</p></li><li><p>How to check it worked.</p></li></ol>' +
      '<h2>Related articles</h2><ul><li><p>Link to related pages.</p></li></ul>',
  },
  {
    key: 'how-to',
    name: 'How-to article',
    description: 'Step-by-step instructions for one task.',
    body:
      '<p>Summarise what this article helps people do, and who it is for.</p>' +
      '<h2>Before you begin</h2><ul><li><p>Anything people need first: access, tools, information.</p></li></ul>' +
      '<h2>Instructions</h2><ol><li><p>Step one.</p></li><li><p>Step two.</p></li><li><p>Step three.</p></li></ol>' +
      '<div data-type="panel" data-panel-type="note"><p>Add a tip, or a warning about a step that is easy to get wrong.</p></div>' +
      '<h2>Related articles</h2><ul><li><p>Link to related pages.</p></li></ul>',
  },
  {
    key: 'file-list',
    name: 'File list',
    description: 'A table of the documents this page collects.',
    body:
      '<p>Attach files to this page with <strong>Attach a file</strong> below the page, then list them here.</p>' +
      '<table><tbody>' +
      '<tr><th><p>File</p></th><th><p>Description</p></th><th><p>Owner</p></th><th><p>Last updated</p></th></tr>' +
      '<tr><td><p>Name of the file</p></td><td><p>What it is for</p></td><td><p>@ someone</p></td><td><p>Date</p></td></tr>' +
      '<tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr>' +
      '</tbody></table>',
  },
]
