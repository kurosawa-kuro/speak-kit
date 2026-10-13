"use client"

import { createContext, useContext } from "react"

export const NavContext = createContext({ pathname: "/today", searchParams: new URLSearchParams(), navigate: () => {} })

export function useNav() {
  return useContext(NavContext)
}

export function parseLocation(to) {
  const [pathname, search = ""] = to.split("?")
  return { pathname: pathname || "/", search }
}
