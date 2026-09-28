import { useMemo } from 'react'
import { ProductContext } from './ProductContext'

/*
 * JL-153 — supplies the active product to the shared top bar.
 *
 * Rendered by each product layout (JiraLayout, ConfluenceLayout), which is
 * what makes "exactly one product is active" a structural fact rather than
 * something each component has to work out from the URL.
 *
 * Repo convention (JL-407): this module exports ONLY the provider component.
 */
export function ProductProvider({ product, children }) {
  // Product descriptors are literals defined at module scope in each layout,
  // so this memo only guards against an inline object being rebuilt per render.
  const value = useMemo(() => product, [product])
  return <ProductContext.Provider value={value}>{children}</ProductContext.Provider>
}
