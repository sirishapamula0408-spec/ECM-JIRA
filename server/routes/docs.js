// server/routes/docs.js
// Public API documentation endpoints (JL-58). No external dependencies.
//   GET /api/openapi.json  -> the raw OpenAPI 3.0 spec (importable into Swagger UI / Postman)
//   GET /api/docs          -> a lightweight, self-contained HTML viewer (no CDN)
//
// Both are mounted BEFORE the auth-protected routes in server/index.js so the
// documentation is publicly viewable without a token.

import { Router } from 'express'
import openapiSpec from '../openapi.js'

const router = Router()

// Serve the machine-readable spec. Any OpenAPI 3.0 tool (Swagger UI, Postman,
// Insomnia, Stoplight, openapi-generator) can consume this directly.
router.get('/openapi.json', (_req, res) => {
  res.json(openapiSpec)
})

// Self-contained HTML viewer. Inline CSS + JS, no external requests. It fetches
// /api/openapi.json at runtime and renders operations grouped by tag.
const DOCS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ECM JIRA Clone API Docs</title>
  <style>
    :root {
      --bg: #f4f5f7; --card: #ffffff; --text: #172b4d; --muted: #5e6c84;
      --border: #dfe1e6; --accent: #0052cc;
      --get: #2684ff; --post: #36b37e; --put: #ff8b00; --patch: #6554c0; --delete: #ff5630;
    }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #0d1117; --card: #161b22; --text: #e6edf3; --muted: #8b949e; --border: #30363d; --accent: #58a6ff; }
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); }
    header { background: var(--accent); color: #fff; padding: 24px 20px; }
    header h1 { margin: 0 0 4px; font-size: 22px; }
    header p { margin: 0; opacity: .9; font-size: 14px; }
    .container { max-width: 960px; margin: 0 auto; padding: 20px; }
    .meta { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin-bottom: 20px; font-size: 14px; color: var(--muted); }
    .meta code { background: var(--bg); padding: 1px 5px; border-radius: 4px; }
    .tag-group { margin-bottom: 28px; }
    .tag-group > h2 { font-size: 16px; border-bottom: 2px solid var(--border); padding-bottom: 6px; }
    .tag-desc { color: var(--muted); font-size: 13px; margin: -4px 0 12px; }
    .op { background: var(--card); border: 1px solid var(--border); border-left-width: 4px; border-radius: 6px; margin-bottom: 10px; overflow: hidden; }
    .op-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; }
    .method { font-weight: 700; font-size: 12px; text-transform: uppercase; color: #fff; padding: 3px 8px; border-radius: 4px; min-width: 62px; text-align: center; }
    .method.get { background: var(--get); } .method.post { background: var(--post); }
    .method.put { background: var(--put); } .method.patch { background: var(--patch); } .method.delete { background: var(--delete); }
    .path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; font-weight: 600; }
    .summary { color: var(--muted); font-size: 13px; margin-left: auto; }
    .op-body { display: none; padding: 4px 14px 14px; border-top: 1px solid var(--border); font-size: 13px; }
    .op.open .op-body { display: block; }
    .op-body h4 { margin: 12px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { font-size: 11px; text-transform: uppercase; color: var(--muted); }
    .pill { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 10px; background: var(--bg); border: 1px solid var(--border); }
    .req { color: var(--delete); font-weight: 600; }
    a { color: var(--accent); }
    .empty { color: var(--muted); font-style: italic; }
  </style>
</head>
<body>
  <header>
    <h1 id="doc-title">API Documentation</h1>
    <p id="doc-sub">Loading&hellip;</p>
  </header>
  <div class="container">
    <div class="meta" id="meta"></div>
    <div id="content"><p class="empty">Loading spec from <code>openapi.json</code>&hellip;</p></div>
  </div>
  <script>
    (function () {
      var SPEC_URL = 'openapi.json';
      function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
      var METHODS = ['get', 'post', 'put', 'patch', 'delete'];

      fetch(SPEC_URL).then(function (r) { return r.json(); }).then(function (spec) {
        render(spec);
      }).catch(function (e) {
        document.getElementById('content').innerHTML = '<p class="empty">Failed to load spec: ' + esc(e.message) + '</p>';
      });

      function schemaName(schema) {
        if (!schema) return '';
        if (schema.$ref) return schema.$ref.split('/').pop();
        if (schema.type === 'array' && schema.items) return schemaName(schema.items) + '[]';
        return schema.type || 'object';
      }

      function render(spec) {
        var info = spec.info || {};
        document.getElementById('doc-title').textContent = info.title || 'API Documentation';
        document.getElementById('doc-sub').textContent = 'Version ' + (info.version || '?') + ' · OpenAPI ' + (spec.openapi || '');
        var hasAuth = spec.components && spec.components.securitySchemes && spec.components.securitySchemes.bearerAuth;
        document.getElementById('meta').innerHTML =
          'Base path: <code>' + esc((spec.servers && spec.servers[0] && spec.servers[0].url) || '/api') + '</code> &nbsp;·&nbsp; ' +
          'Auth: <code>' + (hasAuth ? 'Bearer JWT (Authorization header)' : 'none') + '</code> &nbsp;·&nbsp; ' +
          'Raw spec: <a href="' + SPEC_URL + '">openapi.json</a>';

        // Group operations by tag
        var groups = {};
        var order = (spec.tags || []).map(function (t) { return t.name; });
        var tagDesc = {};
        (spec.tags || []).forEach(function (t) { tagDesc[t.name] = t.description || ''; });

        Object.keys(spec.paths || {}).forEach(function (path) {
          var item = spec.paths[path];
          var pathParams = item.parameters || [];
          METHODS.forEach(function (m) {
            if (!item[m]) return;
            var op = item[m];
            var tag = (op.tags && op.tags[0]) || 'Other';
            if (!groups[tag]) { groups[tag] = []; if (order.indexOf(tag) === -1) order.push(tag); }
            groups[tag].push({ path: path, method: m, op: op, params: (pathParams).concat(op.parameters || []) });
          });
        });

        var html = '';
        order.forEach(function (tag) {
          var ops = groups[tag];
          if (!ops || !ops.length) return;
          html += '<div class="tag-group"><h2>' + esc(tag) + '</h2>';
          if (tagDesc[tag]) html += '<p class="tag-desc">' + esc(tagDesc[tag]) + '</p>';
          ops.forEach(function (o) { html += renderOp(o); });
          html += '</div>';
        });
        document.getElementById('content').innerHTML = html || '<p class="empty">No endpoints documented.</p>';

        Array.prototype.forEach.call(document.querySelectorAll('.op-head'), function (h) {
          h.addEventListener('click', function () { h.parentNode.classList.toggle('open'); });
        });
      }

      function renderOp(o) {
        var op = o.op;
        var body = '';

        if (op.description) body += '<p>' + esc(op.description) + '</p>';

        // Parameters
        if (o.params && o.params.length) {
          body += '<h4>Parameters</h4><table><thead><tr><th>Name</th><th>In</th><th>Type</th><th>Required</th></tr></thead><tbody>';
          o.params.forEach(function (p) {
            body += '<tr><td><code>' + esc(p.name) + '</code></td><td>' + esc(p.in) + '</td><td>' +
              esc(schemaName(p.schema)) + '</td><td>' + (p.required ? '<span class="req">yes</span>' : 'no') + '</td></tr>';
          });
          body += '</tbody></table>';
        }

        // Request body
        if (op.requestBody) {
          var rc = op.requestBody.content && op.requestBody.content['application/json'];
          body += '<h4>Request Body</h4><p><span class="pill">' +
            esc(rc ? schemaName(rc.schema) : 'application/json') + '</span>' +
            (op.requestBody.required ? ' <span class="req">required</span>' : '') + '</p>';
        }

        // Responses
        if (op.responses) {
          body += '<h4>Responses</h4><table><thead><tr><th>Status</th><th>Description</th><th>Schema</th></tr></thead><tbody>';
          Object.keys(op.responses).forEach(function (code) {
            var r = op.responses[code];
            var sch = '';
            if (r.$ref) sch = r.$ref.split('/').pop();
            else if (r.content && r.content['application/json']) sch = schemaName(r.content['application/json'].schema);
            body += '<tr><td><code>' + esc(code) + '</code></td><td>' + esc(r.description || '') + '</td><td>' + esc(sch) + '</td></tr>';
          });
          body += '</tbody></table>';
        }

        var secure = !(op.security && op.security.length === 0);
        return '<div class="op ' + o.method + '">' +
          '<div class="op-head">' +
            '<span class="method ' + o.method + '">' + o.method + '</span>' +
            '<span class="path">' + esc(o.path) + '</span>' +
            (secure ? '<span class="pill" title="Requires bearer JWT">🔒</span>' : '') +
            '<span class="summary">' + esc(op.summary || '') + '</span>' +
          '</div>' +
          '<div class="op-body">' + body + '</div>' +
        '</div>';
      }
    })();
  </script>
</body>
</html>`

router.get('/docs', (_req, res) => {
  res.type('html').send(DOCS_HTML)
})

export default router
