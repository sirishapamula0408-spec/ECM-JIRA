import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined'
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined'
import DashboardCustomizeOutlinedIcon from '@mui/icons-material/DashboardCustomizeOutlined'
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'

/*
 * JL-187 (fosasoft) — the row of starting points under an empty page, as in
 * Confluence. The editor unmounts it as soon as the page has any content.
 */
const ITEMS = [
  { key: 'file-list', label: 'File list', icon: <DescriptionOutlinedIcon fontSize="small" />, kind: 'template' },
  { key: 'troubleshooting', label: 'Troubleshooting article', icon: <BuildOutlinedIcon fontSize="small" />, kind: 'template' },
  { key: 'how-to', label: 'How-to article', icon: <MenuBookOutlinedIcon fontSize="small" />, kind: 'template' },
  { key: 'all-templates', label: 'All templates', icon: <DashboardCustomizeOutlinedIcon fontSize="small" />, kind: 'dialog' },
  { key: 'table', label: 'Table', icon: <TableChartOutlinedIcon fontSize="small" />, kind: 'element' },
  { key: 'info', label: 'Info panel', icon: <InfoOutlinedIcon fontSize="small" />, kind: 'element' },
  { key: 'toc', label: 'Table of contents', icon: <FormatListBulletedIcon fontSize="small" />, kind: 'element' },
  { key: 'more', label: 'More elements', icon: <MoreHorizIcon fontSize="small" />, kind: 'more' },
]

export function QuickInsertPanel({ onTemplate, onAllTemplates, onElement, onMore }) {
  function pick(item, event) {
    if (item.kind === 'template') onTemplate(item.key)
    else if (item.kind === 'dialog') onAllTemplates()
    else if (item.kind === 'element') onElement(item.key)
    else onMore(event.currentTarget)
  }
  return (
    <div className="pe-quick" role="group" aria-label="Start with">
      {ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          className="pe-quick__item"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(event) => pick(item, event)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}

export default QuickInsertPanel
