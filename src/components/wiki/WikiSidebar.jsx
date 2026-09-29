import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { avatarStyle } from '../../utils/avatarColour'
import { useWikiSidebarState } from '../../hooks/useWikiSidebarState'
import {
  ForYouIcon, RecentIcon, StarIcon, SpacesIcon, AppsIcon,
  DocumentIcon, ChevronIcon, PlusIcon, TrashIcon,
} from './WikiIcons'
import { CreateSpaceDialog, DeleteSpaceDialog } from './SpaceDialogs'
import './WikiSidebar.css'

/*
 * JL-152 — the Confluence Lite left sidebar.
 *
 * Persistent across every /wiki route, which is why it is mounted by the route
 * shell rather than by WikiHomePage: a panel that unmounts and remounts per
 * route loses its scroll position and flashes on every navigation.
 *
 * ── Expandable sections ─────────────────────────────────────────────────────
 *
 * Recent, Starred and Spaces expand IN PLACE and must not navigate. That makes
 * each of them a <button aria-expanded>, NOT a link — a link that does not
 * navigate is a broken promise to anyone using a keyboard or a screen reader,
 * and ctrl-click would open a URL that was never meant to exist.
 *
 * "For you" and "Apps" do navigate, so those are NavLinks and take the active
 * highlight from react-router's own isActive rather than a hand-rolled
 * comparison against location.pathname.
 *
 * ── Row actions (JL-156) ────────────────────────────────────────────────────
 *
 * Spaces gained a "+" on its header and a delete control on each Space row.
 * Both are buttons, and both sit BESIDE the row's own button rather than
 * inside it: a <button> inside a <button> is invalid HTML, and browsers
 * resolve it by dropping one — so the nesting that looks obvious would have
 * silently produced one control or the other, not both. Each row is therefore
 * a flex wrapper holding two siblings.
 */

/** A Space's 24x24 tile: its initial, on a colour derived from its key. */
export function SpaceAvatar({ space }) {
  const key = String(space?.key || space?.name || '?')
  return (
    <span className="wiki-space-avatar" style={avatarStyle(key)} aria-hidden="true">
      {key.charAt(0).toUpperCase()}
    </span>
  )
}

/** One expandable nav section: a toggle row, then up to 5 rows in place. */
function ExpandableSection({
  id, label, icon, items, hasMore, expanded, onToggle, renderItem, moreHref, emptyLabel,
  action,
}) {
  const panelId = `wiki-nav-panel-${id}`
  return (
    <li className="wiki-nav-section">
      {/*
        * The toggle and the section action are SIBLINGS. `action` is rendered
        * outside the toggle button, never within it — see the header note.
        */}
      <div className="wiki-nav-rowgroup">
        <button
          type="button"
          className="wiki-nav-row wiki-nav-row--toggle"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => onToggle(id)}
        >
          <span className="wiki-nav-icon">{icon}</span>
          <span className="wiki-nav-label">{label}</span>
          <span className={`wiki-nav-chevron${expanded ? ' wiki-nav-chevron--open' : ''}`}>
            <ChevronIcon size={16} />
          </span>
        </button>
        {action}
      </div>

      {expanded && (
        <ul className="wiki-nav-sublist" id={panelId}>
          {items.length === 0 && <li className="wiki-nav-subempty">{emptyLabel}</li>}
          {items.map(renderItem)}
          {hasMore && (
            <li>
              <NavLink className="wiki-nav-more" to={moreHref}>Show more</NavLink>
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

export function WikiSidebar({ data, loading, collapsed = false, onSpacesChanged }) {
  // JL-153: `collapsed` is the shell's, driven by the single collapse control
  // in the top bar. This panel keeps only its own section expansion.
  const { isExpanded, toggleSection } = useWikiSidebarState()
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)

  const recent = data?.recent ?? []
  const starredPages = data?.starredPages ?? []
  const spaces = data?.spaces ?? []
  const starredSpaces = data?.starredSpaces ?? []
  /*
   * JL-156 — both gates come off the payload rather than a React context.
   *
   * `canCreateSpace` is the server's own answer to requireRole('Member'),
   * which is what POST /api/spaces enforces; asking a context here would
   * restate that rule in a second place, free to drift from it.
   *
   * Deleting is gated per Space on `myRole`, because Space membership is a
   * SECOND axis: being a workspace Member says nothing about whether you
   * administer THIS Space. Absent data means no controls, which is the
   * right way to fail — the server re-checks both anyway.
   */
  const canCreateSpace = Boolean(data?.canCreateSpace)

  const pageRow = (page) => (
    <li key={page.id}>
      <button
        type="button"
        className="wiki-nav-subrow"
        onClick={() => navigate(`/wiki/pages/${page.id}`)}
        title={page.title}
      >
        <DocumentIcon size={16} />
        <span className="wiki-nav-subtitle">{page.title}</span>
      </button>
    </li>
  )

  const spaceRow = (space) => (
    <li key={space.id} className="wiki-nav-rowgroup">
      <button
        type="button"
        className="wiki-nav-subrow"
        onClick={() => navigate(`/spaces?key=${encodeURIComponent(space.key)}`)}
        title={space.name}
      >
        <SpaceAvatar space={space} />
        <span className="wiki-nav-subtitle">{space.name}</span>
      </button>
      {space.myRole === 'Admin' && (
        <button
          type="button"
          className="wiki-nav-action wiki-nav-action--danger"
          /*
           * Named, not "Delete": beside eight rows that all say the same
           * thing, a screen-reader user has no way to tell which one they
           * are on. The visible glyph carries no text, so this label is the
           * only name the control has.
           */
          aria-label={`Delete space ${space.name}`}
          title={`Delete space ${space.name}`}
          onClick={() => setPendingDelete(space)}
        >
          <TrashIcon size={14} />
        </button>
      )}
    </li>
  )

  return (
    <nav
      className={`wiki-sidebar${collapsed ? ' wiki-sidebar--collapsed' : ''}`}
      aria-label="Confluence Lite"
      data-testid="wiki-sidebar"
    >
      {/* Collapsed, the rail is too narrow for labels, sublists or "Show more",
          so it shows the two real destinations and drops everything that would
          be truncated into meaninglessness. */}
      {collapsed ? (
        <ul className="wiki-nav wiki-nav--rail">
          <li>
            <NavLink to="/wiki/home" className="wiki-nav-row" title="For you" aria-label="For you">
              <span className="wiki-nav-icon"><ForYouIcon /></span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/wiki/apps" className="wiki-nav-row" title="Apps" aria-label="Apps">
              <span className="wiki-nav-icon"><AppsIcon /></span>
            </NavLink>
          </li>
        </ul>
      ) : (
        <div className="wiki-sidebar-scroll">
          <ul className="wiki-nav">
            <li>
              <NavLink to="/wiki/home" className="wiki-nav-row">
                <span className="wiki-nav-icon"><ForYouIcon /></span>
                <span className="wiki-nav-label">For you</span>
              </NavLink>
            </li>

            <ExpandableSection
              id="recent"
              label="Recent"
              icon={<RecentIcon />}
              items={recent}
              hasMore={data?.recentHasMore}
              expanded={isExpanded('recent')}
              onToggle={toggleSection}
              renderItem={pageRow}
              moreHref="/wiki/recent"
              emptyLabel={loading ? 'Loading…' : 'Nothing viewed yet'}
            />

            <ExpandableSection
              id="starred"
              label="Starred"
              icon={<StarIcon />}
              items={starredPages}
              hasMore={data?.starredPagesHasMore}
              expanded={isExpanded('starred')}
              onToggle={toggleSection}
              renderItem={pageRow}
              moreHref="/wiki/starred"
              emptyLabel={loading ? 'Loading…' : 'No starred pages'}
            />

            <ExpandableSection
              id="spaces"
              label="Spaces"
              icon={<SpacesIcon />}
              items={spaces}
              hasMore={data?.spacesHasMore}
              expanded={isExpanded('spaces')}
              onToggle={toggleSection}
              renderItem={spaceRow}
              moreHref="/spaces"
              emptyLabel={loading ? 'Loading…' : 'No spaces yet'}
              action={canCreateSpace && (
                <button
                  type="button"
                  className="wiki-nav-action wiki-nav-action--persistent"
                  aria-label="Create a space"
                  title="Create a space"
                  onClick={() => setCreateOpen(true)}
                >
                  <PlusIcon size={16} />
                </button>
              )}
            />

            <li>
              <NavLink to="/wiki/apps" className="wiki-nav-row">
                <span className="wiki-nav-icon"><AppsIcon /></span>
                <span className="wiki-nav-label">Apps</span>
              </NavLink>
            </li>
          </ul>

          {starredSpaces.length > 0 && (
            <section className="wiki-starred-spaces" aria-labelledby="wiki-starred-spaces-heading">
              <h2 className="wiki-sidebar-heading" id="wiki-starred-spaces-heading">
                Starred spaces
              </h2>
              <ul className="wiki-nav">{starredSpaces.map(spaceRow)}</ul>
            </section>
          )}
        </div>
      )}

      {/*
        * Mounted outside the collapsed/expanded branch so a dialog opened from
        * the sidebar survives the shell being collapsed underneath it.
        * `onSpacesChanged` is the layout's own reload — the sidebar keeps no
        * second copy of the Spaces list to fall out of step.
        */}
      <CreateSpaceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => onSpacesChanged?.()}
      />
      <DeleteSpaceDialog
        space={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onDeleted={() => onSpacesChanged?.()}
      />
    </nav>
  )
}
