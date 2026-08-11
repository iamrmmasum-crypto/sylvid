'use client'

import { useEffect, useCallback } from 'react'

/**
 * Activates screen capture protection during video calls.
 * Blocks: right-click, Print Screen, Win+Shift+S, Ctrl+Shift+S,
 * drag, text selection, picture-in-picture, and printing.
 *
 * Note: No web app can 100% prevent OS-level screen capture,
 * but this makes it significantly harder and blocks casual attempts.
 */
export function useScreenProtection(active: boolean) {
  const blockContextMenu = useCallback((e: MouseEvent) => {
    if (active) e.preventDefault()
  }, [active])

  const blockKeydown = useCallback((e: KeyboardEvent) => {
    if (!active) return

    const key = e.key.toLowerCase()
    const ctrl = e.ctrlKey || e.metaKey
    const shift = e.shiftKey

    // Print Screen
    if (key === 'printscreen') {
      e.preventDefault()
      // Clear clipboard for old browsers
      navigator.clipboard?.writeText('').catch(() => {})
      return
    }

    // Win+Shift+S (Windows Snipping Tool)
    if (shift && key === 's' && (ctrl || e.code === 'ShiftLeft' || e.code === 'ShiftRight')) {
      e.preventDefault()
      return
    }

    // Ctrl+Shift+S / Cmd+Shift+S (Firefox/Chrome capture)
    if (ctrl && shift && key === 's') {
      e.preventDefault()
      return
    }

    // Ctrl+P / Cmd+P (Print dialog — can save as PDF)
    if (ctrl && key === 'p') {
      e.preventDefault()
      return
    }

    // Ctrl+S / Cmd+S (Save page)
    if (ctrl && key === 's') {
      e.preventDefault()
      return
    }

    // F12 (DevTools — can inspect video)
    if (key === 'f12') {
      e.preventDefault()
      return
    }

    // Ctrl+Shift+I / Cmd+Option+I (DevTools)
    if (ctrl && shift && key === 'i') {
      e.preventDefault()
      return
    }

    // Ctrl+Shift+J / Cmd+Option+J (Console)
    if (ctrl && shift && key === 'j') {
      e.preventDefault()
      return
    }

    // Ctrl+U / Cmd+U (View source)
    if (ctrl && key === 'u') {
      e.preventDefault()
      return
    }
  }, [active])

  const blockDragStart = useCallback((e: DragEvent) => {
    if (active) e.preventDefault()
  }, [active])

  useEffect(() => {
    if (!active) return

    document.addEventListener('contextmenu', blockContextMenu)
    document.addEventListener('keydown', blockKeydown, true)
    document.addEventListener('dragstart', blockDragStart)

    return () => {
      document.removeEventListener('contextmenu', blockContextMenu)
      document.removeEventListener('keydown', blockKeydown, true)
      document.removeEventListener('dragstart', blockDragStart)
    }
  }, [active, blockContextMenu, blockKeydown, blockDragStart])
}
