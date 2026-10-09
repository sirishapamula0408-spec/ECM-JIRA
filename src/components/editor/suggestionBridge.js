import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { Suggestion, exitSuggestion } from '@tiptap/suggestion'

/*
 * JL-187 (fosasoft) — connects a TipTap suggestion (the "/" menu, @mentions)
 * to a React popup.
 *
 * TipTap drives a suggestion through plain callbacks (start, update, key
 * down, exit); React wants a store it can subscribe to. This is that store:
 * the suggestion writes its props in, SuggestionMenu reads them out with
 * useSyncExternalStore, and registers the key handler the suggestion calls
 * for arrow keys and Enter.
 */
export function createSuggestionBridge() {
  let state = null
  let keyHandler = null
  const listeners = new Set()
  const emit = () => { for (const listener of listeners) listener() }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setKeyHandler(handler) { keyHandler = handler },
    render: () => ({
      onStart: (props) => { state = props; emit() },
      onUpdate: (props) => { state = props; emit() },
      onKeyDown: ({ event, view }) => {
        if (event.key === 'Escape') {
          exitSuggestion(view, state?.pluginKey)
          state = null
          emit()
          return true
        }
        return keyHandler ? keyHandler(event) : false
      },
      onExit: () => { state = null; emit() },
    }),
  }
}

/**
 * A TipTap extension that opens `bridge` when `char` is typed.
 *
 * `items(query)` returns the filtered list; `onSelect(editor, item)` runs
 * after the trigger text ("/hea") has been deleted.
 */
export function createSuggestionExtension({ name, char, bridge, items, onSelect, allowSpaces = false }) {
  const pluginKey = new PluginKey(name)
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char,
          pluginKey,
          allowSpaces,
          items: ({ query }) => items(query),
          command: ({ editor, range, props }) => {
            editor.chain().focus().deleteRange(range).run()
            onSelect(editor, props)
          },
          render: () => {
            const handlers = bridge.render()
            return {
              ...handlers,
              onStart: (props) => handlers.onStart({ ...props, pluginKey }),
              onUpdate: (props) => handlers.onUpdate({ ...props, pluginKey }),
            }
          },
        }),
      ]
    },
  })
}
